import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';

import { extractSemanticDraft } from './semantic.js';
import { normalizeFact } from './store.js';
import { knownTopicFromText, topicFromText } from './topic.js';
import type { ConversationMessage, ConversationPayload, MemoryScope, WorkingMemoryFact, WorkingMemoryFactType } from './types.js';

const SKIP = /^(ok|okay|thanks|thank you|yes|no|sure|please|continue|go on|what is|what are)\.?$/i;
const QUESTION = /^(what|why|how|which|who|where|can you|could you|帮我|怎么|什么是|如何)\b/i;
const PROCESS = /\b(i'll|i will|let me|going to|todo|as follows)\b/i;
const STACK = /\bat\s+\S+\s+\(/;
const EXPLICIT = /^(remember(?:\s+that)?|记住(?:一下)?)\s*[:：]?\s+/i;
const CONVENTION = /^(我们约定|从此以后|以后都|请记住)\s*[:：]?\s*(.+)$/;
const USE_NOT = /(?:请用|用|use)\s+(.+?)\s*(?:，|,)?\s*(?:不要用|别用|而不是|instead of|not)\s+(.+)/i;
const PREFER = /\b(prefer|always use|never use|don't use|do not use)\b|不要用|请用/i;
const CORRECTION = /\b(not npm|not yarn|pnpm|named exports?|tests? live)\b|测试文件|具名导出/;
const SESSION_SCOPE = /\b(this (?:run|session|turn)|这次|本轮|这个会话)\b/i;

const MAX_TRANSCRIPT_BYTES = 256 * 1024;
const MAX_TRANSCRIPT_MESSAGES = 40;

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === 'string') {
      parts.push(item);
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (record.type && record.type !== 'text') continue;
    if (typeof record.text === 'string') parts.push(record.text);
  }
  return parts.join('\n');
}

function roleFromRecord(record: Record<string, unknown>): ConversationMessage['role'] | null {
  const role = record.role ?? record.type;
  if (role === 'user' || role === 'assistant' || role === 'system') return role;
  return null;
}

function messageFromRecord(record: Record<string, unknown>): ConversationMessage | null {
  const nested = record.message && typeof record.message === 'object'
    ? record.message as Record<string, unknown>
    : record;
  const role = roleFromRecord(nested) ?? roleFromRecord(record);
  if (!role) return null;
  const text = textFromContent(nested.content ?? record.content ?? record.text);
  if (!text.trim()) return null;
  return { role, content: text };
}

function parseTranscriptText(raw: string): ConversationMessage[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map(item => (item && typeof item === 'object' ? messageFromRecord(item as Record<string, unknown>) : null))
          .filter((item): item is ConversationMessage => item !== null);
      }
    } catch {
      return [{ role: 'user', content: trimmed }];
    }
  }
  const messages: ConversationMessage[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const row = line.trim();
    if (!row) continue;
    if (!row.startsWith('{')) {
      if (messages.length === 0) return [{ role: 'user', content: trimmed }];
      continue;
    }
    try {
      const parsed = JSON.parse(row) as unknown;
      if (!parsed || typeof parsed !== 'object') continue;
      const message = messageFromRecord(parsed as Record<string, unknown>);
      if (message) messages.push(message);
    } catch {
      continue;
    }
  }
  return messages.length > 0 ? messages : [{ role: 'user', content: trimmed }];
}

function readTranscriptTail(filePath: string): string {
  if (!existsSync(filePath)) return '';
  const size = statSync(filePath).size;
  if (size <= MAX_TRANSCRIPT_BYTES) return readFileSync(filePath, 'utf8');
  const length = Math.min(MAX_TRANSCRIPT_BYTES, size);
  const start = size - length;
  const buffer = Buffer.alloc(length);
  const fd = openSync(filePath, 'r');
  try {
    readSync(fd, buffer, 0, length, start);
  } finally {
    closeSync(fd);
  }
  const text = buffer.toString('utf8');
  const firstNl = text.indexOf('\n');
  return firstNl >= 0 ? text.slice(firstNl + 1) : text;
}

export function readTranscriptMessages(filePath: string): ConversationMessage[] {
  try {
    return parseTranscriptText(readTranscriptTail(filePath));
  } catch {
    return [];
  }
}

function asConversationMessages(value: unknown): ConversationMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ConversationMessage =>
    !!item
    && typeof item === 'object'
    && (item.role === 'user' || item.role === 'assistant' || item.role === 'system')
    && typeof item.content === 'string'
    && item.content.trim().length > 0
  );
}

/** Resolve host hook payloads: explicit messages → transcript → transcript_path → user_prompt. */
export function conversationMessagesFromPayload(payload: ConversationPayload): ConversationMessage[] {
  const explicit = asConversationMessages(payload.messages);
  if (explicit.length > 0) return explicit;
  if (typeof payload.transcript === 'string' && payload.transcript.trim()) {
    return parseTranscriptText(payload.transcript);
  }
  if (typeof payload.transcript_path === 'string' && payload.transcript_path.trim()) {
    const fromPath = readTranscriptMessages(payload.transcript_path.trim());
    if (fromPath.length > 0) return fromPath.slice(-MAX_TRANSCRIPT_MESSAGES);
  }
  const prompt = payload.user_prompt?.trim();
  if (prompt) return [{ role: 'user', content: prompt }];
  return [];
}

function classify(text: string): WorkingMemoryFactType {
  if (EXPLICIT.test(text) || PREFER.test(text) || CONVENTION.test(text) || USE_NOT.test(text)) return 'user';
  if (CORRECTION.test(text)) return 'feedback';
  return 'project';
}

function isNoise(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 8 || trimmed.length > 400) return true;
  if (SKIP.test(trimmed) || QUESTION.test(trimmed)) return true;
  if (PROCESS.test(trimmed)) return true;
  if (STACK.test(trimmed)) return true;
  return trimmed.split('\n').length > 6;
}

function matchesRuleBar(text: string): boolean {
  return EXPLICIT.test(text)
    || PREFER.test(text)
    || CORRECTION.test(text)
    || CONVENTION.test(text)
    || USE_NOT.test(text);
}

function normalizeFactText(text: string): string {
  const convention = text.match(CONVENTION);
  if (convention?.[2]) return convention[2].trim().replace(/\s+/g, ' ');
  return text.replace(EXPLICIT, '').trim().replace(/\s+/g, ' ');
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?\n])|(?<=\.\s)/)
    .map(part => part.trim())
    .filter(Boolean);
}

function scopeFor(text: string, type: WorkingMemoryFactType, payload: ConversationPayload): MemoryScope {
  if (SESSION_SCOPE.test(text) && payload.session_id) return 'session';
  if (type === 'user' || type === 'feedback') return 'user';
  return 'project';
}

function confidenceFor(original: string, type: WorkingMemoryFactType): number {
  if (EXPLICIT.test(original)) return 0.95;
  if (CONVENTION.test(original) || USE_NOT.test(original)) return 0.88;
  if (PREFER.test(original)) return 0.85;
  if (type === 'feedback') return 0.75;
  return 0.65;
}

function factFromSentence(
  sentence: string,
  payload: ConversationPayload,
  createdAt: string,
): WorkingMemoryFact | null {
  if (isNoise(sentence)) return null;
  if (matchesRuleBar(sentence)) {
    const text = normalizeFactText(sentence);
    if (!text) return null;
    const type = classify(sentence);
    return normalizeFact({
      type,
      text,
      created_at: createdAt,
      source: 'extract',
      extract_method: 'rule',
      evidence_kind: 'transcript',
      scope: scopeFor(sentence, type, payload),
      session_id: payload.session_id,
      topic: topicFromText(text),
      confidence: confidenceFor(sentence, type),
      promotion_state: type === 'user' || type === 'feedback' ? 'pending' : 'none',
    }, createdAt);
  }
  const draft = extractSemanticDraft(sentence);
  if (!draft) return null;
  return normalizeFact({
    type: draft.type,
    text: draft.text,
    created_at: createdAt,
    source: 'extract',
    extract_method: 'semantic',
    evidence_kind: 'transcript',
    scope: scopeFor(sentence, draft.type, payload),
    session_id: payload.session_id,
    topic: knownTopicFromText(sentence, draft.text) ?? topicFromText(draft.text),
    confidence: draft.confidence,
    promotion_state: draft.type === 'user' || draft.type === 'feedback' ? 'pending' : 'none',
  }, createdAt);
}

/**
 * Rule/structured fast path, then speech-act frames.
 * Zero facts is a legitimate outcome (quality bar).
 */
export function extractWorkingMemoryFacts(
  payload: ConversationPayload,
  now: () => string = () => new Date().toISOString(),
): WorkingMemoryFact[] {
  const createdAt = now();
  const seen = new Set<string>();
  const facts: WorkingMemoryFact[] = [];
  for (const message of conversationMessagesFromPayload(payload)) {
    if (message.role === 'system') continue;
    for (const sentence of splitSentences(message.content)) {
      const fact = factFromSentence(sentence, payload, createdAt);
      if (!fact || seen.has(fact.id)) continue;
      seen.add(fact.id);
      facts.push(fact);
    }
  }
  return facts;
}

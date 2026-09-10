import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadMemoryConfig } from './config.js';
import {
  conversationMessagesFromPayload,
  extractWorkingMemoryFacts,
} from './extract.js';
import {
  composeWithSpecPriority,
  formatRecalledMemory,
  MEMORY_WRAP_CLOSE,
  MEMORY_WRAP_OPEN,
  selectWorkingMemory,
} from './inject.js';
import { memoriesFromSearchBody, mem0Add } from './mem0-client.js';
import { recallWorkingMemory } from './recall.js';
import { retainWorkingMemory } from './retain.js';
import { retrieveFacts } from './retrieve.js';
import { bagOfWordsEmbedder, embeddingScoresForFacts } from './semantic.js';
import { promoteWorkingMemoryFact } from './promote.js';
import { addFacts, factIdForText, forgetFact, listFacts, normalizeFact, patchFact, rememberFact, upsertFacts, visibleFacts, workingMemoryPath } from './store.js';
import { factsConflict, topicFromText } from './topic.js';
import { DEFAULT_MEMORY_CONFIG, isExtractEnabled, isMem0WriteEnabled } from './types.js';
import { ensureSyntheticKnowledgeSession } from '../run/session-knowledge.js';
import { summarizeSessionKnowledge } from '../run/knowledge.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: process.platform === 'win32' ? 8 : 0, retryDelay: 50 });
    } catch {
      /* Windows may briefly retain a just-closed file */
    }
  }
});

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'maestro-memory-'));
  roots.push(root);
  mkdirSync(join(root, '.workflow'), { recursive: true });
  return root;
}

const isolated = { ...DEFAULT_MEMORY_CONFIG, autoStageSafe: false };

describe('working-memory extract', () => {
  it('keeps explicit preferences and drops process chatter', () => {
    const facts = extractWorkingMemoryFacts({
      messages: [
        { role: 'user', content: 'remember: always use pnpm, not npm' },
        { role: 'assistant', content: "I'll update the lockfile as follows" },
        { role: 'user', content: 'ok' },
      ],
    }, () => '2026-09-10T00:00:00.000Z');
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      type: 'user',
      text: 'always use pnpm, not npm',
      source: 'extract',
      topic: 'package-manager',
      promotion_state: 'pending',
    });
  });

  it('reads Claude-style transcript JSONL from transcript_path', () => {
    const root = tempProject();
    const transcript = join(root, 'transcript.jsonl');
    writeFileSync(transcript, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'prefer named exports in src/memory' }] } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'Noted.' } }),
    ].join('\n'), 'utf8');
    const facts = extractWorkingMemoryFacts({ transcript_path: transcript });
    expect(facts.map(fact => fact.text)).toEqual(['prefer named exports in src/memory']);
  });

  it('falls back to user_prompt when the host has no transcript', () => {
    const messages = conversationMessagesFromPayload({
      user_prompt: 'please use pnpm not yarn for this repo',
    });
    expect(messages).toEqual([{ role: 'user', content: 'please use pnpm not yarn for this repo' }]);
    expect(extractWorkingMemoryFacts({ user_prompt: 'please use pnpm not yarn for this repo' })).toHaveLength(1);
  });

  it('uses speech-act frames when the regex bar misses a paraphrase', () => {
    const facts = extractWorkingMemoryFacts({
      messages: [{ role: 'user', content: 'team decided modules should export by name' }],
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      extract_method: 'semantic',
      topic: 'module-exports',
      confidence: 0.72,
      promotion_state: 'pending',
    });
  });
});

describe('working-memory store lifecycle', () => {
  it('dedupes identical text and forgets by id', () => {
    const root = tempProject();
    const first = rememberFact(root, 'prefer pnpm not npm');
    const again = rememberFact(root, 'prefer pnpm not npm');
    expect(again.id).toBe(first.id);
    expect(listFacts(root)).toHaveLength(1);
    expect(forgetFact(root, first.id)).toBe(true);
    expect(listFacts(root)).toHaveLength(0);
  });

  it('supersedes unknown-topic preferences that share the same objects', () => {
    const root = tempProject();
    rememberFact(root, 'remember: always use the frost indigo palette');
    const next = rememberFact(root, 'remember: never use the frost indigo palette');
    const active = listFacts(root);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(next.id);
    expect(factsConflict(
      { type: 'user', text: 'remember: always use the frost indigo palette', topic: 'general' },
      { type: 'user', text: 'remember: prefer the cherry caramel theme', topic: 'general', status: 'active' },
    )).toBe(false);
    expect(factsConflict(
      { type: 'user', text: 'prefer named exports', topic: 'module-exports' },
      { type: 'user', text: 'always use pnpm, not npm', topic: 'package-manager', status: 'active' },
    )).toBe(false);
  });

  it('supersedes use-X-not-Y over a previous exclusive prefer', () => {
    const root = tempProject();
    rememberFact(root, 'always use bun');
    const next = rememberFact(root, 'use pnpm not npm');
    const active = listFacts(root);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(next.id);
    expect(active[0].text).toContain('pnpm');
  });

  it('keeps a named-export prefer when later chatter only hedges', () => {
    const root = tempProject();
    const first = rememberFact(root, 'prefer named exports');
    rememberFact(root, 'I do not think we need named exports');
    const active = listFacts(root);
    expect(active.some(fact => fact.id === first.id)).toBe(true);
    expect(active.some(fact => fact.text === 'prefer named exports')).toBe(true);
  });

  it('does not overwrite a Chinese theme with another unknown-topic theme', () => {
    const root = tempProject();
    rememberFact(root, '请记住使用深色主题配色方案');
    rememberFact(root, '请记住使用浅色主题配色方案');
    expect(listFacts(root)).toHaveLength(2);
  });

  it('retains a Stop-like transcript payload by conversation id', async () => {
    const root = tempProject();
    const transcript = join(root, 'transcript.jsonl');
    writeFileSync(transcript, `${JSON.stringify({
      role: 'user',
      content: 'remember: always use pnpm not npm',
    })}\n`);
    const retained = await retainWorkingMemory(root, {
      session_id: 'conv-stop-1',
      transcript_path: transcript,
      cwd: root,
    }, { config: isolated, autoStage: false });
    expect(retained.added.length + retained.updated.length).toBeGreaterThan(0);
    expect(listFacts(root).some(fact => fact.text.includes('pnpm'))).toBe(true);
  });

  it('supersedes a conflicting preference on the same topic', () => {
    const root = tempProject();
    rememberFact(root, 'always use npm, not pnpm');
    const next = rememberFact(root, 'always use pnpm, not npm');
    const active = listFacts(root);
    const all = listFacts(root, { status: 'all' });
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(next.id);
    expect(all.some(fact => fact.status === 'superseded' && fact.superseded_by === next.id)).toBe(true);
    expect(topicFromText(next.text)).toBe('package-manager');
  });

  it('hides session-scoped facts unless the host session matches', () => {
    const root = tempProject();
    upsertFacts(root, [normalizeFact({
      type: 'user',
      text: 'this session use bun instead of npm',
      scope: 'session',
      session_id: 'host-1',
      source: 'extract',
    })]);
    expect(visibleFacts(root)).toHaveLength(0);
    expect(visibleFacts(root, 'host-1')).toHaveLength(1);
  });

  it('decays unused facts older than two half-lives', () => {
    const root = tempProject();
    upsertFacts(root, [normalizeFact({
      type: 'project',
      text: 'an old unused project note about lunch',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      use_count: 0,
      confidence: 0.2,
      promotion_state: 'none',
    })]);
    const decayed = listFacts(root, { status: 'all' });
    expect(decayed[0].status).toBe('decayed');
    expect(listFacts(root)).toHaveLength(0);
  });

  it('does not reopen a staged fact or drop its candidate id on re-extract', () => {
    const root = tempProject();
    const fact = rememberFact(root, 'always use named exports');
    patchFact(root, fact.id, {
      promotion_state: 'staged',
      knowledge_candidate_id: 'KDC-0123456789abcdef',
    });
    const again = upsertFacts(root, [normalizeFact({
      type: 'user',
      text: 'always use named exports',
      source: 'extract',
      extract_method: 'rule',
      evidence_kind: 'transcript',
      promotion_state: 'pending',
    })]);
    expect(again.added).toEqual([]);
    expect(again.updated).toEqual([]);
    expect(listFacts(root)[0]).toMatchObject({
      promotion_state: 'staged',
      knowledge_candidate_id: 'KDC-0123456789abcdef',
      source: 'remember',
    });
  });

  it('reactivating a superseded preference re-supersedes the current winner', () => {
    const root = tempProject();
    const first = rememberFact(root, 'always use npm, not pnpm');
    rememberFact(root, 'always use pnpm, not npm');
    const restored = rememberFact(root, 'always use npm, not pnpm');
    const active = listFacts(root);
    const all = listFacts(root, { status: 'all' });
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(first.id);
    expect(restored.id).toBe(first.id);
    expect(all.some(fact => fact.status === 'superseded' && fact.superseded_by === first.id)).toBe(true);
  });

  it('honors project decay half-life and does not reset the clock on re-extract', () => {
    const root = tempProject();
    const created = new Date(Date.now() - 20 * 86_400_000).toISOString();
    upsertFacts(root, [normalizeFact({
      type: 'project',
      text: 'an unused project note about lunch',
      created_at: created,
      updated_at: created,
      use_count: 0,
      confidence: 0.2,
      promotion_state: 'none',
    })]);
    expect(visibleFacts(root)).toHaveLength(1);
    expect(visibleFacts(root, undefined, { decayHalfLifeDays: 7 })).toHaveLength(0);
    upsertFacts(root, [normalizeFact({
      type: 'project',
      text: 'an unused project note about lunch',
      source: 'extract',
      confidence: 0.2,
      promotion_state: 'none',
    })]);
    expect(visibleFacts(root, undefined, { decayHalfLifeDays: 7 })).toHaveLength(0);
  });

  it('does not create an invisible session fact without a host session id', () => {
    const root = tempProject();
    const remembered = rememberFact(root, 'this session use bun instead of npm', 'user', 'session');
    expect(remembered.scope).toBe('project');
    expect(visibleFacts(root)).toHaveLength(1);
    const extracted = extractWorkingMemoryFacts({
      messages: [{ role: 'user', content: 'this session use bun instead of npm' }],
    });
    expect(extracted[0].scope).not.toBe('session');
  });

  it('refuses to wipe a corrupt working-memory file', () => {
    const root = tempProject();
    const path = workingMemoryPath(root);
    mkdirSync(join(root, '.workflow', 'memory'), { recursive: true });
    writeFileSync(path, '{not-json', 'utf8');
    const result = upsertFacts(root, [normalizeFact({
      type: 'user',
      text: 'prefer named exports',
      source: 'remember',
    })]);
    expect(result.added).toEqual([]);
    expect(readFileSync(path, 'utf8')).toBe('{not-json');
    expect(() => rememberFact(root, 'prefer named exports')).toThrow(/Unable to persist/);
  });

  it('recalls session-scoped facts only when the host session is passed through', async () => {
    const root = tempProject();
    const config = { ...isolated };
    await retainWorkingMemory(root, {
      session_id: 'host-1',
      user_prompt: 'this session use bun instead of npm',
    }, { config, autoStage: false });
    const hidden = await recallWorkingMemory(root, 'which package manager', { config, touch: false });
    const visible = await recallWorkingMemory(root, 'which package manager', {
      config,
      sessionId: 'host-1',
      touch: false,
    });
    expect(hidden.facts).toHaveLength(0);
    expect(visible.facts.some(fact => fact.text.includes('bun'))).toBe(true);
  });

  it('keeps a long-horizon unused fact active after recall when project half-life is 90 days', async () => {
    const root = tempProject();
    writeFileSync(join(root, '.workflow', 'config.json'), JSON.stringify({
      memory: { decayHalfLifeDays: 90 },
    }), 'utf8');
    const created = new Date(Date.now() - 70 * 86_400_000).toISOString();
    upsertFacts(root, [normalizeFact({
      type: 'user',
      text: 'always use named exports',
      created_at: created,
      updated_at: created,
      use_count: 0,
      source: 'remember',
      confidence: 0.95,
    })]);
    const config = loadMemoryConfig(root, {}, {});
    expect(config.decayHalfLifeDays).toBe(90);
    expect(listFacts(root, { status: 'active' }, config)).toHaveLength(1);
    expect(listFacts(root)).toHaveLength(0);
    const recalled = await recallWorkingMemory(root, 'how should modules export', { config });
    expect(recalled.facts.some(fact => fact.text.includes('named exports'))).toBe(true);
    const stored = JSON.parse(readFileSync(workingMemoryPath(root), 'utf8')) as { facts: Array<{ status: string; use_count: number }> };
    expect(stored.facts[0].status).toBe('active');
    expect(stored.facts[0].use_count).toBe(1);
    expect(visibleFacts(root, undefined, config)).toHaveLength(1);
  });

  it('skips identical extracted text already stored', () => {
    const root = tempProject();
    const text = 'always use named exports';
    addFacts(root, [normalizeFact({
      id: factIdForText(text),
      type: 'user',
      text,
      created_at: '2026-09-10T00:00:00.000Z',
      source: 'extract',
      evidence_kind: 'transcript',
    })]);
    const added = addFacts(root, [normalizeFact({
      id: factIdForText(text),
      type: 'user',
      text,
      created_at: '2026-09-10T00:01:00.000Z',
      source: 'extract',
      evidence_kind: 'transcript',
    })]);
    expect(added).toEqual([]);
    expect(listFacts(root)).toHaveLength(1);
  });
});

describe('working-memory retrieve', () => {
  it('ranks a paraphrastic package-manager prompt via topic, not lexical overlap', () => {
    const facts = [
      normalizeFact({ id: 'pm', type: 'user', text: 'always use pnpm, not npm', source: 'remember' }),
      normalizeFact({ id: 'ex', type: 'user', text: 'prefer named exports', source: 'remember' }),
    ];
    const query = 'which package manager should the repo use';
    const lexical = retrieveFacts(facts, query, { ...isolated, semantic: 'lexical', minRecallScore: 0.35 });
    expect(lexical.some(item => item.fact.id === 'pm')).toBe(false);
    const topic = retrieveFacts(facts, query, { ...isolated, semantic: 'topic', minRecallScore: 0.35 });
    expect(topic[0].fact.id).toBe('pm');
  });

  it('can blend an injected embedder when semantic is embed', async () => {
    const facts = [
      normalizeFact({ id: 'pm', type: 'project', text: 'always use pnpm, not npm', source: 'extract', confidence: 0.6 }),
      normalizeFact({ id: 'ex', type: 'project', text: 'prefer named exports', source: 'extract', confidence: 0.6 }),
    ];
    const query = 'which package manager should the repo use';
    const scores = await embeddingScoresForFacts(bagOfWordsEmbedder(), query, facts);
    const ranked = retrieveFacts(
      facts,
      query,
      { ...isolated, semantic: 'embed', minRecallScore: 0.2 },
      new Date(),
      scores,
    );
    expect(ranked[0].fact.id).toBe('pm');
  });

  it('ranks the prompt-relevant fact above a newer unrelated one', () => {
    const facts = [
      normalizeFact({ id: 'old', type: 'user', text: 'prefer named exports', created_at: '2026-01-01T00:00:00.000Z', source: 'remember' }),
      normalizeFact({ id: 'new', type: 'project', text: 'the dashboard uses a frost indigo palette', created_at: '2026-09-01T00:00:00.000Z', source: 'extract', confidence: 0.4 }),
    ];
    const ranked = retrieveFacts(facts, 'exports and module surface', isolated);
    expect(ranked[0].fact.id).toBe('old');
    expect(ranked.some(item => item.fact.id === 'new')).toBe(false);
  });

  it('injects sticky facts for an empty query instead of dumping everything', () => {
    const root = tempProject();
    rememberFact(root, 'prefer named exports');
    upsertFacts(root, [normalizeFact({
      type: 'project',
      text: 'random meeting note about lunch',
      source: 'extract',
      confidence: 0.2,
      promotion_state: 'none',
    })]);
    const selected = selectWorkingMemory(root, '', isolated);
    expect(selected.some(fact => fact.text.includes('named exports'))).toBe(true);
    expect(selected.some(fact => fact.text.includes('lunch'))).toBe(false);
  });

  it('keeps spec context ahead of memory and drops duplicate remote texts', () => {
    const memory = formatRecalledMemory(
      [normalizeFact({ id: 'a', type: 'user', text: 'prefer pnpm', source: 'remember' })],
      ['prefer pnpm', 'use named exports'],
      isolated,
    );
    expect(memory).toContain(MEMORY_WRAP_OPEN);
    expect(memory).toContain(MEMORY_WRAP_CLOSE);
    expect(memory).toContain('prefer pnpm');
    expect(memory).toContain('use named exports');
    expect(memory.match(/prefer pnpm/g)?.length).toBe(1);
    const composed = composeWithSpecPriority('<maestro-context>\n## specs\n</maestro-context>', memory);
    expect(composed.startsWith('<maestro-context>')).toBe(true);
  });

  it('merges Mem0 search hits into recall output', async () => {
    const root = tempProject();
    rememberFact(root, 'prefer named exports');
    const recalled = await recallWorkingMemory(root, 'exports', {
      config: { ...isolated, mem0ApiKey: 'test-key' },
      fetchImpl: async () => new Response(JSON.stringify({
        results: [{ memory: 'tests live next to the module' }],
      }), { status: 200 }),
      touch: false,
    });
    expect(recalled.mem0).toEqual({ skipped: false, status: 200 });
    expect(recalled.content).toContain('prefer named exports');
    expect(recalled.content).toContain('tests live next to the module');
  });

  it('returns empty content when auto is off', async () => {
    const root = tempProject();
    rememberFact(root, 'prefer named exports');
    const recalled = await recallWorkingMemory(root, 'exports', {
      config: { ...isolated, auto: 'off' },
    });
    expect(recalled.content).toBe('');
  });
});

describe('working-memory retain modes', () => {
  it('defaults to promote-safe automation', () => {
    expect(DEFAULT_MEMORY_CONFIG.auto).toBe('promote-safe');
    expect(isExtractEnabled(DEFAULT_MEMORY_CONFIG.auto)).toBe(true);
    expect(isMem0WriteEnabled(DEFAULT_MEMORY_CONFIG.auto)).toBe(false);
  });

  it('skips extract in index mode', async () => {
    const root = tempProject();
    const result = await retainWorkingMemory(root, {
      messages: [{ role: 'user', content: 'remember: always use pnpm not npm' }],
    }, { config: { ...isolated, auto: 'index' }, autoStage: false });
    expect(result.skipped).toBe(true);
    expect(listFacts(root)).toHaveLength(0);
  });

  it('default promote-safe config remembers a fact and recalls it by prompt', async () => {
    const root = tempProject();
    const config = loadMemoryConfig(root, {}, {});
    expect(config.auto).toBe('promote-safe');
    expect(config.semantic).toBe('topic');
    const retained = await retainWorkingMemory(root, {
      messages: [{ role: 'user', content: "let's standardize on pnpm for installs" }],
    }, { config, autoStage: false });
    expect(retained.added.length + retained.updated.length).toBeGreaterThan(0);
    const recalled = await recallWorkingMemory(root, 'which package manager should the repo use', {
      config,
      touch: false,
    });
    expect(recalled.facts.some(fact => fact.text.includes('pnpm'))).toBe(true);
  });

  it('writes local facts in promote-safe without calling Mem0', async () => {
    const root = tempProject();
    let called = false;
    const result = await retainWorkingMemory(root, {
      messages: [{ role: 'user', content: 'remember: always use pnpm not npm' }],
    }, {
      config: { ...isolated, auto: 'promote-safe', mem0ApiKey: 'test-key' },
      fetchImpl: async () => {
        called = true;
        return new Response('{}', { status: 200 });
      },
      autoStage: false,
    });
    expect(result.skipped).toBe(false);
    expect(result.added).toHaveLength(1);
    expect(result.mem0.skipped).toBe(true);
    expect(called).toBe(false);
  });
});

describe('working-memory knowledge handoff', () => {
  it('stages a fact onto a synthetic Session knowledge ledger', async () => {
    const root = tempProject();
    writeFileSync(join(root, '.workflow', 'config.json'), JSON.stringify({
      session_schema: {
        schema_version: 'session-schema-selection/1.0',
        writer: 'session/3.0',
        features: { session_statusless: false },
      },
    }), 'utf8');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'evidence.ts'), '// memory evidence\n', 'utf8');
    const session = ensureSyntheticKnowledgeSession(root, 'memory-host');
    const fact = rememberFact(root, 'prefer named exports in src/memory');
    const staged = promoteWorkingMemoryFact(root, fact.id, undefined, session.sessionId);
    expect(staged.candidate_id).toBeTruthy();
    expect(staged.session_id).toBe(session.sessionId);
    const summary = summarizeSessionKnowledge(root, session.sessionId, { readOnly: true });
    expect(summary.candidates.some(item => item.candidate_id === staged.candidate_id)).toBe(true);
    expect(listFacts(root)[0].promotion_state).toBe('staged');
    const { reconcileSessionKnowledgeSync } = await import('../knowledge/reconcile.js');
    const receipt = reconcileSessionKnowledgeSync(root, session.sessionId);
    expect(receipt.candidates.some(item => item.candidate_id === staged.candidate_id)).toBe(true);
    expect(summary.candidates.find(item => item.candidate_id === staged.candidate_id)?.status).toBe('pending');
  });
});

describe('memory config and mem0 helpers', () => {
  it('prefers project config then env over defaults', () => {
    const root = tempProject();
    writeFileSync(join(root, '.workflow', 'config.json'), JSON.stringify({
      memory: { auto: 'extract', mem0UserId: 'from-project' },
    }), 'utf8');
    const config = loadMemoryConfig(root, {
      MAESTRO_MEMORY_AUTO: 'promote-safe',
      MEM0_USER_ID: 'from-env',
    }, {});
    expect(config.auto).toBe('promote-safe');
    expect(config.mem0UserId).toBe('from-env');
  });

  it('parses common Mem0 search envelopes', () => {
    expect(memoriesFromSearchBody({ results: [{ memory: 'a' }, { text: 'a' }, { content: 'b' }] })).toEqual(['a', 'b']);
    expect(memoriesFromSearchBody({ memories: ['c'] })).toEqual(['c']);
  });

  it('skips Mem0 writes when no API key is configured', async () => {
    const result = await mem0Add(DEFAULT_MEMORY_CONFIG, {
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result).toEqual({ skipped: true });
  });
});

import { NODE_KINDS, LANGUAGES } from '../types.js';
import type { NodeKind, Language } from '../types.js';

export interface ParsedQuery {
  text: string;
  kinds: NodeKind[];
  languages: Language[];
  pathFilters: string[];
  nameFilters: string[];
}

const KIND_VALUES: ReadonlySet<string> = new Set(NODE_KINDS);
const LANGUAGE_VALUES: ReadonlySet<string> = new Set(LANGUAGES);

function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

export function parseQuery(raw: string): ParsedQuery {
  const out: ParsedQuery = {
    text: '',
    kinds: [],
    languages: [],
    pathFilters: [],
    nameFilters: [],
  };

  const tokens: string[] = [];
  let i = 0;
  while (i < raw.length) {
    while (i < raw.length && /\s/.test(raw[i]!)) i++;
    if (i >= raw.length) break;
    const start = i;
    while (i < raw.length && !/\s/.test(raw[i]!)) {
      if (raw[i] === '"') {
        const end = raw.indexOf('"', i + 1);
        if (end === -1) { i = raw.length; break; }
        i = end + 1;
        continue;
      }
      i++;
    }
    tokens.push(raw.slice(start, i));
  }

  const textParts: string[] = [];
  for (const tok of tokens) {
    const colon = tok.indexOf(':');
    if (colon <= 0 || colon === tok.length - 1) {
      textParts.push(tok);
      continue;
    }
    const key = tok.slice(0, colon).toLowerCase();
    const valueRaw = unquote(tok.slice(colon + 1));
    if (!valueRaw) { textParts.push(tok); continue; }

    switch (key) {
      case 'kind':
        if (KIND_VALUES.has(valueRaw)) out.kinds.push(valueRaw as NodeKind);
        else textParts.push(tok);
        break;
      case 'lang':
      case 'language': {
        const lower = valueRaw.toLowerCase();
        if (LANGUAGE_VALUES.has(lower)) out.languages.push(lower as Language);
        else textParts.push(tok);
        break;
      }
      case 'path':
        out.pathFilters.push(valueRaw);
        break;
      case 'name':
        out.nameFilters.push(valueRaw);
        break;
      default:
        textParts.push(tok);
    }
  }

  out.text = textParts.join(' ').trim();
  return out;
}

export function boundedEditDistance(a: string, b: string, maxDist: number): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > maxDist) return maxDist + 1;
  if (al === 0) return bl;
  if (bl === 0) return al;

  let prev = new Array<number>(bl + 1);
  let cur = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;

  for (let i = 1; i <= al; i++) {
    cur[0] = i;
    let rowMin = cur[0]!;
    for (let j = 1; j <= bl; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      if (cur[j]! < rowMin) rowMin = cur[j]!;
    }
    if (rowMin > maxDist) return maxDist + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[bl]!;
}

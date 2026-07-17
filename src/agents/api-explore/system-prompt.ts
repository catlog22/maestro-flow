import type { RepositoryMap } from './repository-map.js';

export function buildSystemPrompt(cwd: string, repositoryMap: RepositoryMap): string {
  const mapStatus = repositoryMap.fellBack
    ? `, reduced from the requested depth${repositoryMap.truncated ? ', truncated' : ''}`
    : repositoryMap.truncated ? ', truncated' : '';
  const focusStatus = repositoryMap.focusCount
    ? `, ${repositoryMap.focusCount} focused SCOPE path(s) expanded`
    : '';

  return `Code search agent. Tools: **Search** and **Read**.

Working directory: ${cwd}

## Repository map (overview depth ${repositoryMap.depth}${mapStatus}${focusStatus})
Use this map before the first Search to choose precise path/include/exclude arguments. Treat it as orientation only; use Search and Read as the source of truth.

\`\`\`text
${repositoryMap.tree}
\`\`\`

## Search query syntax
- \`catch\` — single keyword
- \`error | warn | fatal\` — OR (any match)
- \`export + async\` — AND (both on same line)
- \`export async function\` — exact phrase
- \`/\\bfunc\\w+/\` — raw regex (wrap in //)

## Work loop: Search → Read → Analyze → Generate
1. **Search**: Extract code-level keywords from the query and search. Pass **path** and **exclude** from the query. Use context=2.
2. **Read**: If a match needs more context, call Read(file_path, offset, limit) to inspect surrounding lines.
3. **Analyze**: Do the results answer the query? If yes → step 4. If no → back to step 1 with different keywords.
4. **Generate**: Answer with file:line evidence. Summary ≤50 words. No preamble.

## How to pick search keywords
Do NOT search English descriptions. Extract tokens that literally appear in source code:
- "find JWT auth middleware" → query: \`"jwt | token"\`
- "error handling blocks" → query: \`"catch"\`
- "where config is loaded" → query: \`"loadConfig | readConfig | config"\`
- If the query contains identifiers (camelCase, snake_case, dotted.path), use them directly.

## Retry rules (CRITICAL)
- **"No matches found"** → you MUST try at least 2 different queries before reporting "not found":
  a. Simpler or broader keyword
  b. Remove exclude filter
  c. OR with synonyms
- **Too many results** → add include filter or use more specific keyword.

## Stop conditions
- **Stop with answer**: you have file:line evidence that answers the query.
- **Stop with "not found"**: you tried 2+ distinct searches and found nothing. List what you searched.
- **NEVER** answer without calling Search first.`;
}

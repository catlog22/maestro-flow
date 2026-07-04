import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type LlmConfig, type LlmFormat } from './llm.js';
import { TOOL_SCHEMAS } from './tools.js';
import { buildSystemPrompt } from './system-prompt.js';
import { agentLoop } from './agent-loop.js';
import { loadExploreConfig, getDefaultEndpoint, resolveExploreProxyUrl } from './config.js';

function parseArgs(argv: string[]): { llmConfig: LlmConfig; cwd: string; maxTurns: number } {
  let model = '';
  let baseUrl = '';
  let apiKey = '';
  let format = '';
  let cwd = process.cwd();
  let maxTurns = 0;

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--model': case '-m':
        model = argv[++i] ?? '';
        break;
      case '--base-url':
        baseUrl = argv[++i] ?? '';
        break;
      case '--api-key':
        apiKey = argv[++i] ?? '';
        break;
      case '--format':
        format = argv[++i] ?? '';
        break;
      case '--cwd':
        cwd = argv[++i] ?? process.cwd();
        break;
      case '--max-turns':
        maxTurns = parseInt(argv[++i] ?? '0', 10);
        break;
    }
  }

  const fileConfig = loadExploreConfig();
  const proxyUrl = resolveExploreProxyUrl(fileConfig);

  model = model || fileConfig.model || process.env.API_EXPLORE_MODEL || '';
  baseUrl = baseUrl || fileConfig.baseUrl || process.env.API_EXPLORE_BASE_URL || '';
  apiKey = apiKey || fileConfig.apiKey || process.env.API_EXPLORE_API_KEY || process.env.OPENAI_API_KEY || '';
  maxTurns = maxTurns || fileConfig.maxTurns || 6;
  const extraBody = fileConfig.extraBody;
  const resolvedFormat: LlmFormat = (format || fileConfig.format || 'openai') as LlmFormat;

  if (!model || !baseUrl || !apiKey) {
    // Try named endpoints as fallback
    const defaultEp = getDefaultEndpoint(fileConfig);
    if (defaultEp) {
      return { llmConfig: { ...defaultEp, proxyUrl }, cwd: resolve(cwd), maxTurns };
    }

    process.stderr.write(
      'Error: model, baseUrl, and apiKey are required.\n' +
      'Configure via ~/.maestro/api.json:\n' +
      '  { "endpoints": { "default": { "baseUrl": "https://...", "apiKey": "sk-...", "model": "..." } } }\n' +
      'Or via CLI args: --model --base-url --api-key\n' +
      'Or via env: API_EXPLORE_MODEL, API_EXPLORE_BASE_URL, API_EXPLORE_API_KEY\n',
    );
    process.exit(1);
  }

  return { llmConfig: { model, baseUrl, apiKey, format: resolvedFormat, extraBody, proxyUrl }, cwd: resolve(cwd), maxTurns };
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', reject);
  });
}

function getDirListing(cwd: string): string {
  try {
    return readdirSync(cwd)
      .filter(name => !name.startsWith('.'))
      .slice(0, 50)
      .join('\n');
  } catch {
    return '(unable to list directory)';
  }
}

async function main(): Promise<void> {
  const { llmConfig, cwd, maxTurns } = parseArgs(process.argv);
  const prompt = await readStdin();

  if (!prompt.trim()) {
    process.stderr.write('Error: no prompt received on stdin\n');
    process.exit(1);
  }

  const { client, config } = createClient(llmConfig);
  const dirListing = getDirListing(cwd);
  const systemPrompt = buildSystemPrompt(cwd, dirListing);

  const result = await agentLoop({
    prompt: prompt.trim(),
    systemPrompt,
    client,
    llmConfig: config,
    toolSchemas: TOOL_SCHEMAS,
    maxTurns,
    cwd,
  });

  if (!result) {
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

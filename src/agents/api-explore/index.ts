import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createClient, type LlmConfig } from './llm.js';
import { TOOL_SCHEMAS } from './tools.js';
import { buildSystemPrompt } from './system-prompt.js';
import { agentLoop } from './agent-loop.js';

interface ApiExploreConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  maxTurns?: number;
  /** Model-specific extra body params (e.g. {"enable_thinking": true} for Qwen) */
  extraBody?: Record<string, unknown>;
}

function loadConfigFile(): ApiExploreConfig {
  const configPath = join(homedir(), '.maestro', 'api-explore.json');
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as ApiExploreConfig;
  } catch {
    return {};
  }
}

function parseArgs(argv: string[]): { llmConfig: LlmConfig; cwd: string; maxTurns: number } {
  let model = '';
  let baseUrl = '';
  let apiKey = '';
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
      case '--cwd':
        cwd = argv[++i] ?? process.cwd();
        break;
      case '--max-turns':
        maxTurns = parseInt(argv[++i] ?? '0', 10);
        break;
    }
  }

  // Priority: CLI args > config file > env vars
  const fileConfig = loadConfigFile();

  model = model || fileConfig.model || process.env.API_EXPLORE_MODEL || '';
  baseUrl = baseUrl || fileConfig.baseUrl || process.env.API_EXPLORE_BASE_URL || '';
  apiKey = apiKey || fileConfig.apiKey || process.env.API_EXPLORE_API_KEY || process.env.OPENAI_API_KEY || '';
  maxTurns = maxTurns || fileConfig.maxTurns || 6;
  const extraBody = fileConfig.extraBody;

  if (!model || !baseUrl || !apiKey) {
    process.stderr.write(
      'Error: model, baseUrl, and apiKey are required.\n' +
      'Configure via ~/.maestro/api-explore.json:\n' +
      '  { "baseUrl": "https://...", "apiKey": "sk-...", "model": "..." }\n' +
      'Or via CLI args: --model --base-url --api-key\n' +
      'Or via env: API_EXPLORE_MODEL, API_EXPLORE_BASE_URL, API_EXPLORE_API_KEY\n',
    );
    process.exit(1);
  }

  return { llmConfig: { model, baseUrl, apiKey, extraBody }, cwd: resolve(cwd), maxTurns };
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

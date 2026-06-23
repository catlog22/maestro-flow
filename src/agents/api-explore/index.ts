import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from './llm.js';
import { TOOL_SCHEMAS } from './tools.js';
import { buildSystemPrompt } from './system-prompt.js';
import { agentLoop } from './agent-loop.js';

function parseArgs(argv: string[]): { model: string; baseUrl: string; apiKey: string; cwd: string; maxTurns: number } {
  let model = '';
  let baseUrl = '';
  let apiKey = '';
  let cwd = process.cwd();
  let maxTurns = 6;

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
        maxTurns = parseInt(argv[++i] ?? '6', 10);
        break;
    }
  }

  model = model || process.env.API_EXPLORE_MODEL || '';
  baseUrl = baseUrl || process.env.API_EXPLORE_BASE_URL || '';
  apiKey = apiKey || process.env.API_EXPLORE_API_KEY || process.env.OPENAI_API_KEY || '';

  if (!model) {
    process.stderr.write('Error: --model or API_EXPLORE_MODEL is required\n');
    process.exit(1);
  }
  if (!baseUrl) {
    process.stderr.write('Error: --base-url or API_EXPLORE_BASE_URL is required\n');
    process.exit(1);
  }
  if (!apiKey) {
    process.stderr.write('Error: --api-key or API_EXPLORE_API_KEY/OPENAI_API_KEY is required\n');
    process.exit(1);
  }

  return { model, baseUrl, apiKey, cwd: resolve(cwd), maxTurns };
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
  const config = parseArgs(process.argv);
  const prompt = await readStdin();

  if (!prompt.trim()) {
    process.stderr.write('Error: no prompt received on stdin\n');
    process.exit(1);
  }

  const { client, model } = createClient(config);
  const dirListing = getDirListing(config.cwd);
  const systemPrompt = buildSystemPrompt(config.cwd, dirListing);

  const result = await agentLoop({
    prompt: prompt.trim(),
    systemPrompt,
    client,
    model,
    toolSchemas: TOOL_SCHEMAS,
    maxTurns: config.maxTurns,
    cwd: config.cwd,
  });

  if (!result) {
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { loadMemoryConfig } from './config.js';
import {
  createHandlerMcpSession,
  pickMcpTool,
  type McpCallRecord,
  type McpToolDescriptor,
} from './mcp-client.js';
import { discoverMemoryMcpLaunch, shouldDiscoverMemoryMcp } from './mcp-discover.js';
import { recallWorkingMemory } from './recall.js';
import { retainWorkingMemory } from './retain.js';
import { DEFAULT_MEMORY_CONFIG, type MemoryConfig } from './types.js';

const roots: string[] = [];
const fixtureDir = dirname(fileURLToPath(import.meta.url));
const stubStdio = join(fixtureDir, '__fixtures__', 'stub-mcp-stdio.mjs');

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
  const root = mkdtempSync(join(tmpdir(), 'maestro-memory-mcp-'));
  roots.push(root);
  mkdirSync(join(root, '.workflow'), { recursive: true });
  return root;
}

function mcpConfig(overrides: Partial<MemoryConfig> = {}): MemoryConfig {
  return {
    ...DEFAULT_MEMORY_CONFIG,
    autoStageSafe: false,
    remote: 'mcp',
    mcpServer: 'memory',
    mcpWrite: true,
    ...overrides,
  };
}

const SEARCH_HIT = 'stub-search-hit-maple-glaze-unique';

function stubSession(calls: Array<{ method: string; params: unknown }>, tools?: McpToolDescriptor[]) {
  const listed: McpToolDescriptor[] = tools ?? [
    {
      name: 'memory_search',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, project: { type: 'string' }, limit: { type: 'integer' } },
        required: ['query'],
      },
    },
    {
      name: 'memory_add',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' }, project: { type: 'string' } },
        required: ['text'],
      },
    },
  ];
  return createHandlerMcpSession(async (method, params) => {
    calls.push({ method, params });
    if (method === 'tools/list') return { tools: listed };
    if (method === 'tools/call') {
      const body = params as McpCallRecord;
      if (body.name === listed.find(tool => pickMcpTool(listed, 'search')?.name === tool.name)?.name
        || /search/i.test(body.name)) {
        return { content: [{ type: 'text', text: SEARCH_HIT }] };
      }
      return { content: [{ type: 'text', text: 'added' }] };
    }
    throw new Error(`unexpected MCP method ${method}`);
  });
}

describe('memory MCP tool mapping', () => {
  it('picks search/add from listed names without a product prefix', () => {
    const tools: McpToolDescriptor[] = [
      { name: 'facts_search', inputSchema: { properties: { query: {} }, required: ['query'] } },
      { name: 'facts_remember', inputSchema: { properties: { text: {} }, required: ['text'] } },
    ];
    expect(pickMcpTool(tools, 'search')?.name).toBe('facts_search');
    expect(pickMcpTool(tools, 'add')?.name).toBe('facts_remember');
  });
});

describe('working-memory MCP recall/retain', () => {
  it('fills recall inject text from MCP tools/list then tools/call search', async () => {
    const root = tempProject();
    const calls: Array<{ method: string; params: unknown }> = [];
    const recalled = await recallWorkingMemory(root, 'which glaze', {
      config: mcpConfig({ mcpWrite: false }),
      mcpSession: stubSession(calls),
      touch: false,
    });
    expect(calls.some(call => call.method === 'tools/list')).toBe(true);
    const searchCall = calls.find(call => call.method === 'tools/call') as { params: McpCallRecord } | undefined;
    expect(searchCall?.params.name).toBe('memory_search');
    expect(searchCall?.params.arguments.query).toBe('which glaze');
    expect(recalled.mcp.skipped).toBe(false);
    expect(recalled.mcp.texts.some(text => text.includes(SEARCH_HIT))).toBe(true);
    expect(recalled.content).toContain(SEARCH_HIT);
  });

  it('retain tools/call add uses the given statement', async () => {
    const root = tempProject();
    const statement = 'remember: always use maple-glaze for orchestration memory tests';
    const calls: Array<{ method: string; params: unknown }> = [];
    const retained = await retainWorkingMemory(root, { user_prompt: statement }, {
      config: mcpConfig(),
      mcpSession: stubSession(calls),
      autoStage: false,
    });
    const addCall = calls.find(call => call.method === 'tools/call') as { params: McpCallRecord } | undefined;
    expect(addCall?.params.name).toBe('memory_add');
    expect(addCall?.params.arguments.text).toBe(statement);
    expect(retained.mcp.skipped).toBe(false);
    expect(retained.mcp.tool).toBe('memory_add');
  });

  it('fail-open when MCP is unset: local extract still runs, remote skipped', async () => {
    const root = tempProject();
    const retained = await retainWorkingMemory(root, {
      messages: [{ role: 'user', content: 'remember: always use pnpm not npm' }],
    }, {
      config: { ...DEFAULT_MEMORY_CONFIG, autoStageSafe: false, remote: 'off' },
      autoStage: false,
    });
    expect(retained.mcp.skipped).toBe(true);
    expect(retained.added.length + retained.updated.length).toBeGreaterThan(0);
    const recalled = await recallWorkingMemory(root, 'which package manager', {
      config: { ...DEFAULT_MEMORY_CONFIG, autoStageSafe: false, remote: 'off' },
      touch: false,
    });
    expect(recalled.mcp.skipped).toBe(true);
    expect(recalled.facts.some(fact => fact.text.includes('pnpm'))).toBe(true);
  });

  it('fail-open when the MCP server refuses connect', async () => {
    const root = tempProject();
    const recalled = await recallWorkingMemory(root, 'exports', {
      config: mcpConfig({
        mcpWrite: false,
        mcpCommand: 'maestro-memory-mcp-missing-binary',
        mcpArgs: [],
      }),
      touch: false,
    });
    expect(recalled.mcp.skipped).toBe(true);
    const retained = await retainWorkingMemory(root, {
      user_prompt: 'remember: always use pnpm not npm',
    }, {
      config: mcpConfig({
        mcpCommand: 'maestro-memory-mcp-missing-binary',
        mcpArgs: [],
      }),
      autoStage: false,
    });
    expect(retained.mcp.skipped).toBe(true);
    expect(retained.added.length + retained.updated.length).toBeGreaterThan(0);
  });

  it('stdio stub: recall hit and retain add round-trip through JSON-RPC', async () => {
    const root = tempProject();
    const statement = 'remember: stdio stub prefers cedar-token-orchestration';
    const config = mcpConfig({
      mcpCommand: process.execPath,
      mcpArgs: [stubStdio],
    });
    const retained = await retainWorkingMemory(root, { user_prompt: statement }, {
      config,
      autoStage: false,
    });
    expect(retained.mcp.skipped).toBe(false);
    const recalled = await recallWorkingMemory(root, 'cedar-token-orchestration', {
      config: { ...config, mcpWrite: false },
      touch: false,
    });
    expect(recalled.mcp.skipped).toBe(false);
    expect(recalled.mcp.texts.some(text => text.includes('cedar-token-orchestration'))).toBe(true);
    expect(recalled.content).toContain('cedar-token-orchestration');
  });
});

describe('memory MCP config', () => {
  it('reads named MCP server from project config', () => {
    const root = tempProject();
    writeFileSync(join(root, '.workflow', 'config.json'), JSON.stringify({
      memory: {
        remote: 'mcp',
        mcpServer: 'memory',
        mcpCommand: 'python3',
        mcpArgs: ['/opt/memory/mcp_server.py'],
        mcpWrite: false,
      },
    }), 'utf8');
    const config = loadMemoryConfig(root, {}, {});
    expect(config.remote).toBe('mcp');
    expect(config.mcpServer).toBe('memory');
    expect(config.mcpCommand).toBe('python3');
    expect(config.mcpArgs).toEqual(['/opt/memory/mcp_server.py']);
    expect(config.mcpWrite).toBe(false);
  });

  it('env overrides command and can leave remote off', () => {
    const root = tempProject();
    const config = loadMemoryConfig(root, {
      MAESTRO_MEMORY_REMOTE: 'off',
      MAESTRO_MEMORY_MCP_COMMAND: 'python3',
    }, {});
    expect(config.remote).toBe('off');
    expect(config.mcpCommand).toBe('python3');
  });

  it('does not auto-discover a host MCP server under Vitest', () => {
    const root = tempProject();
    const config = loadMemoryConfig(root, {}, {});
    expect(config.remote).toBe('off');
    expect(config.mcpCommand).toBe('');
    expect(shouldDiscoverMemoryMcp({})).toBe(false);
  });

  it('discovers a host-installed memory MCP stdio server and enables remote mcp', () => {
    const home = tempProject();
    const plugin = join(home, '.grok', 'installed-plugins', 'example-memory', 'lib');
    mkdirSync(plugin, { recursive: true });
    writeFileSync(join(plugin, 'mcp_server.py'), '# stub\n', 'utf8');
    const launch = discoverMemoryMcpLaunch({ home, python: process.execPath, env: {} });
    expect(launch?.command).toBe(process.execPath);
    expect(launch?.args[0]).toContain('mcp_server.py');
    expect(launch?.server).toBe('memory');

    const root = tempProject();
    const config = loadMemoryConfig(root, {
      MAESTRO_MEMORY_MCP_DISCOVER: '1',
      MAESTRO_MEMORY_MCP_HOME: home,
    }, {});
    expect(config.remote).toBe('mcp');
    expect(config.mcpCommand).toBeTruthy();
    expect(config.mcpArgs.some(arg => arg.endsWith('mcp_server.py'))).toBe(true);
  });
});

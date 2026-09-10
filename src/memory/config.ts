import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfig } from '../config/index.js';
import { discoverMemoryMcpLaunch, shouldDiscoverMemoryMcp } from './mcp-discover.js';
import {
  DEFAULT_MEMORY_CONFIG,
  MEMORY_AUTO_MODES,
  MEMORY_REMOTE_MODES,
  MEMORY_SEMANTIC_MODES,
  type MemoryAutoMode,
  type MemoryConfig,
  type MemoryRemoteMode,
  type MemorySemanticMode,
} from './types.js';

function asMode(value: unknown): MemoryAutoMode | undefined {
  if (typeof value !== 'string') return undefined;
  return (MEMORY_AUTO_MODES as readonly string[]).includes(value)
    ? value as MemoryAutoMode
    : undefined;
}

function asSemantic(value: unknown): MemorySemanticMode | undefined {
  if (typeof value !== 'string') return undefined;
  return (MEMORY_SEMANTIC_MODES as readonly string[]).includes(value)
    ? value as MemorySemanticMode
    : undefined;
}

function asRemote(value: unknown): MemoryRemoteMode | undefined {
  if (typeof value !== 'string') return undefined;
  return (MEMORY_REMOTE_MODES as readonly string[]).includes(value)
    ? value as MemoryRemoteMode
    : undefined;
}

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (!value.every(item => typeof item === 'string')) return undefined;
  return value as string[];
}

function parseArgsEnv(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      return asStringList(JSON.parse(trimmed));
    } catch {
      return undefined;
    }
  }
  return trimmed.split(/\s+/).filter(Boolean);
}

function pickMemory(raw: Record<string, unknown> | undefined): Partial<MemoryConfig> {
  if (!raw) return {};
  const auto = asMode(raw.auto);
  const semantic = asSemantic(raw.semantic);
  const remote = asRemote(raw.remote);
  const mcpArgs = asStringList(raw.mcpArgs);
  return {
    ...(auto ? { auto } : {}),
    ...(semantic ? { semantic } : {}),
    ...(remote ? { remote } : {}),
    ...(typeof raw.mcpServer === 'string' ? { mcpServer: raw.mcpServer } : {}),
    ...(typeof raw.mcpCommand === 'string' ? { mcpCommand: raw.mcpCommand } : {}),
    ...(mcpArgs ? { mcpArgs } : {}),
    ...(typeof raw.mcpWrite === 'boolean' ? { mcpWrite: raw.mcpWrite } : {}),
    ...(typeof raw.mem0ApiKey === 'string' ? { mem0ApiKey: raw.mem0ApiKey } : {}),
    ...(typeof raw.mem0BaseUrl === 'string' ? { mem0BaseUrl: raw.mem0BaseUrl } : {}),
    ...(typeof raw.mem0UserId === 'string' ? { mem0UserId: raw.mem0UserId } : {}),
    ...(typeof raw.mem0AgentId === 'string' ? { mem0AgentId: raw.mem0AgentId } : {}),
    ...(typeof raw.mem0AppId === 'string' ? { mem0AppId: raw.mem0AppId } : {}),
    ...(typeof raw.workingSetMaxLines === 'number' ? { workingSetMaxLines: raw.workingSetMaxLines } : {}),
    ...(typeof raw.workingSetMaxBytes === 'number' ? { workingSetMaxBytes: raw.workingSetMaxBytes } : {}),
    ...(typeof raw.decayHalfLifeDays === 'number' ? { decayHalfLifeDays: raw.decayHalfLifeDays } : {}),
    ...(typeof raw.minRecallScore === 'number' ? { minRecallScore: raw.minRecallScore } : {}),
    ...(typeof raw.recallLimit === 'number' ? { recallLimit: raw.recallLimit } : {}),
    ...(typeof raw.stickyLimit === 'number' ? { stickyLimit: raw.stickyLimit } : {}),
    ...(typeof raw.autoStageSafe === 'boolean' ? { autoStageSafe: raw.autoStageSafe } : {}),
  };
}

function readProjectMemory(projectRoot: string): Partial<MemoryConfig> {
  const candidates = [
    join(projectRoot, '.workflow', 'config.json'),
    join(projectRoot, '.maestro', 'config.json'),
  ];
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf8')) as { memory?: Record<string, unknown> };
      const picked = pickMemory(raw.memory);
      if (Object.keys(picked).length > 0) return picked;
    } catch {
      continue;
    }
  }
  return {};
}

function readGlobalMemory(): Partial<MemoryConfig> {
  try {
    return pickMemory(loadConfig().memory as Record<string, unknown> | undefined);
  } catch {
    return {};
  }
}

export function loadMemoryConfig(
  projectRoot: string,
  env: NodeJS.Dict<string | undefined> = process.env,
  globalMemory?: Partial<MemoryConfig>,
): MemoryConfig {
  const fromGlobal = globalMemory ?? readGlobalMemory();
  const fromProject = readProjectMemory(projectRoot);
  const envAuto = asMode(env.MAESTRO_MEMORY_AUTO);
  const envRemote = asRemote(env.MAESTRO_MEMORY_REMOTE);
  const envCommand = env.MAESTRO_MEMORY_MCP_COMMAND?.trim() ?? '';
  const envArgs = parseArgsEnv(env.MAESTRO_MEMORY_MCP_ARGS);
  const envWrite = env.MAESTRO_MEMORY_MCP_WRITE;
  const envKey = env.MEM0_API_KEY ?? env.MAESTRO_MEM0_API_KEY ?? '';
  const merged = { ...DEFAULT_MEMORY_CONFIG, ...fromGlobal, ...fromProject };
  const mcpWrite = envWrite === '1' || envWrite === 'true' || envWrite === 'yes'
    ? true
    : envWrite === '0' || envWrite === 'false' || envWrite === 'no'
      ? false
      : merged.mcpWrite;
  const specifiedRemote = envRemote ?? fromProject.remote ?? fromGlobal.remote;
  let remote = envRemote ?? merged.remote;
  let mcpServer = env.MAESTRO_MEMORY_MCP_SERVER || merged.mcpServer;
  let mcpCommand = envCommand || merged.mcpCommand;
  let mcpArgs = envArgs ?? merged.mcpArgs;
  // Runtime default: if a host memory MCP stdio server is installed, Maestro
  // recall/inject uses it. Explicit remote=off stays local-only. Vitest skips
  // discovery unless MAESTRO_MEMORY_MCP_DISCOVER=1.
  if (specifiedRemote !== 'off' && !mcpCommand && shouldDiscoverMemoryMcp(env)) {
    const found = discoverMemoryMcpLaunch({ env });
    if (found) {
      remote = 'mcp';
      mcpCommand = found.command;
      mcpArgs = found.args;
      if (!mcpServer) mcpServer = found.server;
    }
  }
  return {
    ...merged,
    ...(envAuto ? { auto: envAuto } : {}),
    remote,
    mcpServer,
    mcpCommand,
    mcpArgs,
    mcpWrite,
    mem0ApiKey: envKey || merged.mem0ApiKey,
    mem0UserId: env.MEM0_USER_ID || merged.mem0UserId,
    mem0AgentId: env.MEM0_AGENT_ID || merged.mem0AgentId,
    mem0AppId: env.MEM0_APP_ID || merged.mem0AppId,
    mem0BaseUrl: env.MEM0_BASE_URL || merged.mem0BaseUrl,
  };
}

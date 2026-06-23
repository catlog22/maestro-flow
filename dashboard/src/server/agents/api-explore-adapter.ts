// ---------------------------------------------------------------------------
// ApiExploreAdapter — lightweight wrapper around StreamJsonAdapter for the
// api-explore agent script (src/agents/api-explore/index.ts).
//
// The agent script speaks stream-json protocol on stdout, so all parsing
// is inherited from StreamJsonAdapter. We only override argument building
// and environment mapping.
// ---------------------------------------------------------------------------

import { join } from 'node:path';
import type { AgentType, AgentConfig } from '../../shared/agent-types.js';
import { StreamJsonAdapter } from './stream-json-adapter.js';

function resolveAgentScript(): string {
  const distRoot = join(__dirname, '..', '..', '..', '..', 'dist', 'src', 'agents', 'api-explore', 'index.js');
  return `node "${distRoot}"`;
}

export class ApiExploreAdapter extends StreamJsonAdapter {
  constructor() {
    super(resolveAgentScript(), 'api-explore' as AgentType);
  }

  protected override buildArgs(config: AgentConfig): string[] {
    const args: string[] = [];
    if (config.model) {
      args.push('--model', config.model);
    }
    if (config.baseUrl) {
      args.push('--base-url', config.baseUrl);
    }
    if (config.apiKey) {
      args.push('--api-key', config.apiKey);
    }
    if (config.workDir) {
      args.push('--cwd', config.workDir);
    }
    return args;
  }
}

import type { HooksConfig, MaestroPlugin } from '../types/index.js';
import { WorkflowHookRegistry } from './workflow-hooks.js';
import { loadHooksConfig } from '../config/index.js';

export class HookManager {
  private config: HooksConfig;
  private registry: WorkflowHookRegistry;

  constructor(config?: HooksConfig) {
    this.config = config ?? loadHooksConfig();
    this.registry = new WorkflowHookRegistry();
  }

  applyPlugin(plugin: MaestroPlugin): void {
    if (this.config.toggles[plugin.name] === false) return;
    this.registry.apply(plugin);
  }

  isEnabled(hookName: string): boolean {
    return this.config.toggles[hookName] !== false;
  }

  getRegistry(): WorkflowHookRegistry {
    return this.registry;
  }

  getConfig(): HooksConfig {
    return this.config;
  }
}

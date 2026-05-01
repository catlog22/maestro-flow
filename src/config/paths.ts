import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

const MAESTRO_HOME = process.env.MAESTRO_HOME ?? join(homedir(), '.maestro');

export const paths = {
  home: MAESTRO_HOME,
  config: join(MAESTRO_HOME, 'config.json'),
  specs: join(MAESTRO_HOME, 'specs'),
  extensions: join(MAESTRO_HOME, 'extensions'),
  data: join(MAESTRO_HOME, 'data'),
  logs: join(MAESTRO_HOME, 'logs'),
  cliHistory: join(MAESTRO_HOME, 'cli-history'),
  skillConfig: join(MAESTRO_HOME, 'skill-config.json'),

  project(root: string) {
    return {
      root: resolve(root),
      workflow: join(root, '.workflow'),
      templates: join(root, 'templates'),
    };
  },

  ensure(...dirs: string[]) {
    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  },
} as const;

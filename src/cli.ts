import { Command } from 'commander';
import { registerServeCommand } from './commands/serve.js';
import { registerRunCommand } from './commands/run.js';
import { registerExtCommand } from './commands/ext.js';
import { registerToolCommand } from './commands/tool.js';
import { registerCliCommand } from './commands/cli.js';
import { registerInstallCommand } from './commands/install.js';
import { registerUninstallCommand } from './commands/uninstall.js';
import { registerViewCommand } from './commands/view.js';
import { registerStopCommand } from './commands/stop.js';
import { registerSpecCommand } from './commands/spec.js';
import { registerHooksCommand } from './commands/hooks.js';
import { registerCoordinateCommand } from './commands/coordinate.js';
import { registerLinkCoordinateCommand } from './commands/link-coordinate.js';

const program = new Command();

program
  .name('maestro')
  .description('Workflow orchestration CLI with MCP support and extensible architecture')
  .version('0.1.0');

registerServeCommand(program);
registerRunCommand(program);
registerExtCommand(program);
registerToolCommand(program);
registerCliCommand(program);
registerInstallCommand(program);
registerUninstallCommand(program);
registerViewCommand(program);
registerStopCommand(program);
registerSpecCommand(program);
registerHooksCommand(program);
registerCoordinateCommand(program);
registerLinkCoordinateCommand(program);

program.parse();

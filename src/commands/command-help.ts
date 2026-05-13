// ---------------------------------------------------------------------------
// `maestro command-help` — open the command reference HTML page in browser
// ---------------------------------------------------------------------------

import type { Command } from 'commander';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGuideDir(): string {
  // From dist/src/commands/command-help.js → 4 levels up to package root
  return resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', 'guide');
}

function openBrowser(filePath: string): void {
  const url = `file:///${filePath.replace(/\\/g, '/')}`;
  try {
    if (process.platform === 'win32') {
      execSync(`start "" "${url}"`, { stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      execSync(`open "${url}"`, { stdio: 'ignore' });
    } else {
      execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
    }
    console.error(`  Opened command reference in browser`);
  } catch {
    console.error(`  Could not open browser. Open manually: ${url}`);
  }
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerCommandHelpCommand(program: Command): void {
  program
    .command('command-help')
    .alias('ch')
    .description('Open the Maestro command reference guide in browser')
    .option('--path <file>', 'Custom HTML file path (defaults to guide/command-usage-guide.html)')
    .action(async (opts: { path?: string }) => {
      const guideDir = getGuideDir();
      const htmlFile = opts.path
        ? resolve(opts.path)
        : join(guideDir, 'command-usage-guide.html');

      if (!existsSync(htmlFile)) {
        console.error(`  Error: Command reference not found at ${htmlFile}`);
        console.error('  Run the guide generation first.');
        process.exit(1);
      }

      console.error('');
      console.error('  Maestro Command Reference');
      console.error(`  File: ${htmlFile}`);
      console.error('');
      openBrowser(htmlFile);
      console.error('');
    });
}

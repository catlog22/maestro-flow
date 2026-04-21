/**
 * Spec Command — CLI endpoint for project spec management
 *
 * Subcommands: load, list, init, status
 */

import type { Command } from 'commander';

export function registerSpecCommand(program: Command): void {
  const spec = program
    .command('spec')
    .description('Project spec management (init, load, list, status)');

  // ── load ──────────────────────────────────────────────────────────────
  spec
    .command('load')
    .description('Load specs matching category')
    .option('--category <stage>', 'Filter by category: coding|arch|quality|debug|test|review|learning')
    .option('--stdin', 'Read input from stdin (Hook mode)')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const { loadSpecs } = await import('../tools/spec-loader.js');

      let projectPath = process.cwd();

      if (opts.stdin) {
        try {
          const raw = await readStdin();
          if (raw) {
            const stdinData = JSON.parse(raw);
            if (stdinData?.cwd && typeof stdinData.cwd === 'string') {
              projectPath = stdinData.cwd;
            }
          }
        } catch {
          process.stdout.write(JSON.stringify({ continue: true }));
          process.exit(0);
        }
      }

      const result = loadSpecs(projectPath, opts.category);

      if (opts.stdin) {
        if (result.content) {
          const wrapped = `<project-specs>\n${result.content}\n</project-specs>`;
          process.stdout.write(JSON.stringify({ continue: true, systemMessage: wrapped }));
        } else {
          process.stdout.write(JSON.stringify({ continue: true }));
        }
        process.exit(0);
      }

      if (opts.json) {
        console.log(JSON.stringify({
          specs: result.matchedSpecs,
          totalLoaded: result.totalLoaded,
          content: result.content,
        }, null, 2));
      } else {
        console.log(result.content || '(No specs found)');
      }
    });

  // ── list ──────────────────────────────────────────────────────────────
  spec
    .command('list')
    .alias('ls')
    .description('List spec files in .workflow/specs/')
    .action(async () => {
      const { existsSync, readdirSync } = await import('node:fs');
      const { join } = await import('node:path');

      const specsDir = join(process.cwd(), '.workflow', 'specs');
      if (!existsSync(specsDir)) {
        console.log('No specs directory. Run "maestro spec init" to create.');
        return;
      }

      const files = readdirSync(specsDir).filter(f => f.endsWith('.md'));
      if (files.length === 0) {
        console.log('No spec files found.');
        return;
      }

      console.log(`Specs (${files.length} files)\n`);
      for (const file of files) {
        console.log(`  ${file}`);
      }
    });

  // ── init ──────────────────────────────────────────────────────────────
  spec
    .command('init')
    .description('Initialize spec system with seed documents')
    .action(async () => {
      const { initSpecSystem } = await import('../tools/spec-init.js');

      console.log('Initializing spec system...');
      const result = initSpecSystem(process.cwd());

      if (result.directories.length > 0) {
        console.log('\nDirectories created:');
        for (const dir of result.directories) console.log(`  + ${dir}`);
      }

      if (result.created.length > 0) {
        console.log('\nSeed files created:');
        for (const file of result.created) console.log(`  + ${file}`);
      }

      if (result.skipped.length > 0) {
        console.log('\nSkipped (already exist):');
        for (const file of result.skipped) console.log(`  - ${file}`);
      }

      if (result.directories.length === 0 && result.created.length === 0) {
        console.log('\nSpec system already initialized. No changes made.');
      }
    });

  // ── status ────────────────────────────────────────────────────────────
  spec
    .command('status')
    .description('Show spec system status')
    .action(async () => {
      const { existsSync, readdirSync, readFileSync } = await import('node:fs');
      const { join } = await import('node:path');

      const specsDir = join(process.cwd(), '.workflow', 'specs');
      const dirExists = existsSync(specsDir);

      if (!dirExists) {
        console.log('Spec directory: missing');
        console.log('Run "maestro spec init" to initialize.');
        return;
      }

      const files = readdirSync(specsDir).filter(f => f.endsWith('.md'));
      console.log('Spec System Status\n');
      console.log(`  Directory: OK`);
      console.log(`  Files: ${files.length}\n`);

      for (const file of files) {
        const size = readFileSync(join(specsDir, file), 'utf-8').length;
        console.log(`    ${file}  (${size} chars)`);
      }
    });
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('readable', () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk as string;
      }
    });
    process.stdin.on('end', () => resolve(data));
    if (process.stdin.isTTY) resolve('');
  });
}

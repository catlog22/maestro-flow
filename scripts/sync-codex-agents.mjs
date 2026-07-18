#!/usr/bin/env node

import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = process.cwd();
const write = process.argv.includes('--write');
const check = process.argv.includes('--check') || !write;
const sourceDir = join(root, '.claude');
const checkedInDir = join(root, '.codex', 'agents');
const tempDir = mkdtempSync(join(tmpdir(), 'maestro-codex-agents-'));
const generatedDir = join(tempDir, 'generated');

function transpileSource(sourcePath, outputPath) {
  const source = readFileSync(sourcePath, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: sourcePath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
    },
    reportDiagnostics: true,
  });
  const diagnostics = result.diagnostics ?? [];
  if (diagnostics.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) {
    const messages = diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    throw new Error(`Cannot transpile ${sourcePath}:\n${messages.join('\n')}`);
  }
  writeFileSync(outputPath, result.outputText.replace('./codex-agent-overrides.js', './codex-agent-overrides.mjs'), 'utf8');
}

function tomlFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.toml'))
    .map(entry => entry.name)
    .sort();
}

try {
  const overrideModule = join(tempDir, 'codex-agent-overrides.mjs');
  const converterModule = join(tempDir, 'skill-converter.mjs');
  transpileSource(join(root, 'src', 'core', 'codex-agent-overrides.ts'), overrideModule);
  transpileSource(join(root, 'src', 'core', 'skill-converter.ts'), converterModule);

  const [{ buildCodexAgents }, { lintCodexAgentToml }] = await Promise.all([
    import(`${pathToFileURL(converterModule).href}?sync=${Date.now()}`),
    import(`${pathToFileURL(overrideModule).href}?sync=${Date.now()}`),
  ]);

  mkdirSync(generatedDir, { recursive: true });
  buildCodexAgents(sourceDir, generatedDir);
  const generatedFiles = tomlFiles(generatedDir);
  const lintErrors = [];
  for (const file of generatedFiles) {
    const content = readFileSync(join(generatedDir, file), 'utf8');
    lintErrors.push(...lintCodexAgentToml(file, content));
  }
  if (lintErrors.length > 0) {
    throw new Error(`Codex agent schema lint failed:\n${lintErrors.map(issue => `- [${issue.rule}] ${issue.message}`).join('\n')}`);
  }

  if (write) {
    mkdirSync(checkedInDir, { recursive: true });
    const expected = new Set(generatedFiles);
    for (const existing of tomlFiles(checkedInDir)) {
      if (!expected.has(existing)) rmSync(join(checkedInDir, existing));
    }
    for (const file of generatedFiles) {
      writeFileSync(join(checkedInDir, file), readFileSync(join(generatedDir, file)));
    }
    console.log(`updated ${generatedFiles.length} Codex agents`);
  }

  if (check) {
    const checkedInFiles = tomlFiles(checkedInDir);
    const drift = [];
    if (JSON.stringify(checkedInFiles) !== JSON.stringify(generatedFiles)) {
      drift.push(`file set differs (generated=${generatedFiles.length}, checked-in=${checkedInFiles.length})`);
    }
    for (const file of generatedFiles) {
      const target = join(checkedInDir, file);
      if (!existsSync(target)) continue;
      if (readFileSync(target, 'utf8') !== readFileSync(join(generatedDir, file), 'utf8')) drift.push(file);
    }
    if (drift.length > 0) {
      throw new Error(`Codex agent mirrors are stale:\n${drift.map(item => `- ${item}`).join('\n')}\nRun: node scripts/sync-codex-agents.mjs --write`);
    }
    console.log(`checked ${generatedFiles.length} Codex agents: schema and parity OK`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

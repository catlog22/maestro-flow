#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REQUIRED_OPERATIONS = [
  'create', 'next', 'complete', 'brief', 'recall', 'resolve', 'resume', 'fork', 'import',
  'check', 'decide', 'seal-session', 'chain-insert', 'chain-replace', 'chain-skip', 'meta-update', 'accept-reuse',
];

const RELEASE_MACHINE_COMMAND = 'node scripts/check-session-run-release-machine.mjs';

const GUIDE_REQUIREMENTS = [
  {
    id: 'docs.search.zh',
    path: 'guide/search-system-guide.md',
    tokens: ['`session/1.3` + `command-run/1.3`', '1.0-1.3', 'cache v3', 'version: 3', 'fail closed'],
  },
  {
    id: 'docs.search.en',
    path: 'guide/search-system-guide.en.md',
    tokens: ['`session/1.3` + `command-run/1.3`', '1.0-1.3', 'cache v3', 'version: 3', 'fail closed'],
  },
  {
    id: 'docs.architecture',
    path: 'guide/session-run-architecture.md',
    tokens: ['session/1.3', 'command-run/1.3', 'run-response/1.0', ...REQUIRED_OPERATIONS],
  },
  {
    id: 'docs.structure',
    path: 'guide/session-run-structure-guide.md',
    tokens: ['session/1.3', 'command-run/1.3', 'run-response/1.0', ...REQUIRED_OPERATIONS],
  },
  {
    id: 'docs.cli.zh',
    path: 'guide/cli-commands-guide.md',
    tokens: ['session/1.3', 'command-run/1.3', 'run-response/1.0', ...REQUIRED_OPERATIONS],
  },
  {
    id: 'docs.cli.en',
    path: 'guide/cli-commands-guide.en.md',
    tokens: ['session/1.3', 'command-run/1.3', 'run-response/1.0', ...REQUIRED_OPERATIONS],
  },
];

function parseRoot(argv) {
  if (argv.length === 0) return process.cwd();
  if (argv.length === 2 && argv[0] === '--root' && argv[1]) return resolve(argv[1]);
  console.error('Usage: node scripts/check-session-run-contract-parity.mjs [--root <path>]');
  process.exit(2);
}

const root = parseRoot(process.argv.slice(2));

function read(relativePath) {
  try {
    return readFileSync(join(root, relativePath), 'utf8');
  } catch {
    return null;
  }
}

function block(text, start, end) {
  if (text === null) return '';
  const startIndex = text.indexOf(start);
  if (startIndex < 0) return '';
  const endIndex = text.indexOf(end, startIndex + start.length);
  return text.slice(startIndex, endIndex < 0 ? text.length : endIndex);
}

function schemaLiteral(text, start, end) {
  return block(text, start, end).match(/schema_version:\s*z\.literal\(['"]([^'"]+)['"]\)/)?.[1] ?? null;
}

function comparedVersions(text, functionName, prefix) {
  const source = block(text, `function ${functionName}`, '\nfunction ');
  return [...source.matchAll(/raw\.schema_version\s*!==\s*['"]([^'"]+)['"]/g)]
    .map(match => match[1])
    .filter(version => version.startsWith(prefix));
}

function enumLiterals(text, declaration, end) {
  return [...block(text, declaration, end).matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
}

function sameValues(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

const checks = [];

function addCheck(id, actual, expected, pass) {
  checks.push({ id, actual, expected, pass });
}

const writer = read('src/run/schemas.ts');
addCheck(
  'writer.session.current',
  schemaLiteral(writer, 'export const sessionStateV13Schema', 'export type SessionStateInput'),
  'session/1.3',
  schemaLiteral(writer, 'export const sessionStateV13Schema', 'export type SessionStateInput') === 'session/1.3',
);
addCheck(
  'writer.command-run.current',
  schemaLiteral(writer, 'export const commandRunV13Schema', 'export const commandRunReadSchema'),
  'command-run/1.3',
  schemaLiteral(writer, 'export const commandRunV13Schema', 'export const commandRunReadSchema') === 'command-run/1.3',
);

const wikiReader = read('dashboard/src/server/wiki/virtual-wiki-adapters.ts');
const sessionReaderVersions = comparedVersions(wikiReader, 'normalizeRunModeSession', 'session/');
const runReaderVersions = comparedVersions(wikiReader, 'normalizeRunModeRun', 'command-run/');
const expectedSessionReaderVersions = ['session/1.0', 'session/1.1', 'session/1.2', 'session/1.3'];
const expectedRunReaderVersions = ['command-run/1.0', 'command-run/1.1', 'command-run/1.2', 'command-run/1.3'];
addCheck(
  'reader.session.compatibility',
  sessionReaderVersions,
  expectedSessionReaderVersions,
  sameValues(sessionReaderVersions, expectedSessionReaderVersions),
);
addCheck(
  'reader.command-run.compatibility',
  runReaderVersions,
  expectedRunReaderVersions,
  sameValues(runReaderVersions, expectedRunReaderVersions),
);

const wikiIndexer = read('dashboard/src/server/wiki/wiki-indexer.ts');
const cacheVersion = Number(wikiIndexer?.match(/const\s+SEARCH_CACHE_VERSION\s*=\s*(\d+)\s*;/)?.[1] ?? Number.NaN);
addCheck('cache.search.version', Number.isNaN(cacheVersion) ? null : cacheVersion, 3, cacheVersion === 3);

const protocolSchemas = read('src/run/protocol-schemas.ts');
const operations = enumLiterals(protocolSchemas, 'export const runOperationSchema', 'const responseCommonSchema');
addCheck('response.operations.complete', operations, REQUIRED_OPERATIONS, sameValues(operations, REQUIRED_OPERATIONS));

const runCommands = read('src/commands/run.ts');
const acceptReuseCommand = block(runCommands, ".command('accept-reuse <run-id>')", "\n  run.command(");
const acceptReuseMachineHandler = {
  command: acceptReuseCommand.includes(".command('accept-reuse <run-id>')"),
  json: acceptReuseCommand.includes(".option('--json'"),
  business: /const\s+result\s*=\s*acceptRunReuse\s*\(/.test(acceptReuseCommand),
  success: /machineSuccess\s*\(\s*['"]accept-reuse['"]/.test(acceptReuseCommand),
  error: /machineError\s*\(\s*['"]accept-reuse['"]/.test(acceptReuseCommand),
};
addCheck(
  'cli.accept-reuse.machine-handler',
  acceptReuseMachineHandler,
  { command: true, json: true, business: true, success: true, error: true },
  Object.values(acceptReuseMachineHandler).every(Boolean),
);

const releaseMachine = read('scripts/check-session-run-release-machine.mjs');
const releaseMachineCoverage = {
  childProcess: releaseMachine?.includes('spawnSync') ?? false,
  acceptReuse: releaseMachine?.includes("'accept-reuse'") ?? false,
  mutations: releaseMachine?.includes("'mutations'") ?? false,
  commanderUsage: releaseMachine?.includes("'COMMANDER_USAGE'") ?? false,
  applied: releaseMachine?.includes("'applied'") ?? false,
  replayed: releaseMachine?.includes("'replayed'") ?? false,
};
addCheck(
  'release-machine.coverage',
  releaseMachineCoverage,
  { childProcess: true, acceptReuse: true, mutations: true, commanderUsage: true, applied: true, replayed: true },
  Object.values(releaseMachineCoverage).every(Boolean),
);

for (const requirement of GUIDE_REQUIREMENTS) {
  const text = read(requirement.path);
  const missing = text === null ? ['<missing-file>', ...requirement.tokens] : requirement.tokens.filter(token => !text.includes(token));
  addCheck(requirement.id, { path: requirement.path, missing }, { missing: [] }, missing.length === 0);
}

let packageJson = null;
try {
  packageJson = JSON.parse(read('package.json') ?? 'null');
} catch {
  packageJson = null;
}
const packageCommand = packageJson?.scripts?.['check:session-run-contract-parity'] ?? null;
addCheck(
  'package.command',
  packageCommand,
  'node scripts/check-session-run-contract-parity.mjs',
  packageCommand === 'node scripts/check-session-run-contract-parity.mjs',
);
const releaseMachineCommand = packageJson?.scripts?.['check:session-run-release-machine'] ?? null;
addCheck(
  'package.release-machine.command',
  releaseMachineCommand,
  RELEASE_MACHINE_COMMAND,
  releaseMachineCommand === RELEASE_MACHINE_COMMAND,
);
const prepublishSteps = String(packageJson?.scripts?.prepublishOnly ?? '').split('&&').map(step => step.trim()).filter(Boolean);
const expectedReleaseOrder = [
  'npm run check:session-run-contract-parity',
  'npm run build',
  'npm run check:session-run-release-machine',
  'npm run build:mirrors',
];
const releaseIndexes = expectedReleaseOrder.map(step => prepublishSteps.indexOf(step));
addCheck(
  'package.prepublish.order',
  { steps: prepublishSteps, indexes: releaseIndexes },
  { ordered: expectedReleaseOrder },
  releaseIndexes.every(index => index >= 0)
    && releaseIndexes.every((index, position) => position === 0 || index > releaseIndexes[position - 1]),
);

for (const check of checks) {
  const status = check.pass ? 'PASS' : 'FAIL';
  console.log(`${status} ${check.id} actual=${JSON.stringify(check.actual)} expected=${JSON.stringify(check.expected)}`);
}

const failures = checks.filter(check => !check.pass);
if (failures.length > 0) {
  console.error(`session-run contract parity failed: ${failures.length} check(s)`);
  process.exitCode = 1;
} else {
  console.log(`session-run contract parity passed: ${checks.length} checks`);
}

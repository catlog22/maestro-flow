#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import {
  inspectExecutionPromptSuite,
  inspectExecutionPromptSupport,
} from './session-execution-prompt-semantics.mjs';

const LEGACY_OPERATIONS = [
  'create', 'next', 'complete', 'brief', 'recall', 'resolve', 'resume', 'fork', 'import',
  'check', 'decide', 'seal-session', 'chain-insert', 'chain-replace', 'chain-skip', 'meta-update', 'accept-reuse',
  'plan-publish',
];

const EXECUTION_OPERATIONS = [
  'capabilities', 'session-create', 'session-archive', 'session-unarchive',
  'execution-start', 'execution-attach', 'execution-status', 'execution-pause',
  'execution-resolve', 'execution-resume', 'execution-seal', 'execution-handoff-prepare',
  'execution-handoff-accept', 'execution-handoff-cancel', 'execution-lease-status',
  'execution-lease-heartbeat', 'execution-lease-release', 'execution-lease-recover',
];

const REQUIRED_OPERATIONS = [...LEGACY_OPERATIONS, ...EXECUTION_OPERATIONS];

const RELEASE_MACHINE_COMMAND = 'node scripts/check-session-run-release-machine.mjs';

const EXPECTED_FOCUSED_RELEASE_TESTS = [
  'commits the seal before lock release so release failure cannot roll it back',
  'commits the lease release before lock release so release failure cannot roll it back and remains replayable',
  'revalidates the same Execution anchor for reuse while aliases and later activity stay Session-global',
  'promotes a reviewed session candidate without sealing the Session',
];

const REQUIRED_RELEASE_MACHINE_OPERATION_TOKENS = [
  "'execution', 'handoff', 'prepare'",
  "'execution', 'seal'",
  "'execution', 'lease', 'release'",
  "'execution-chain-bootstrap'",
  "'plan', 'publish'",
  "'run', 'next'",
  "'run', 'complete'",
  "'step-000-execute'",
  "'step-001-verify'",
];

const WAVE2_GUIDE_TOKENS = [
  'session/2.0', 'session-schema-selection/1.0', 'session_statusless=true',
  '--to session/2.0', 'session-archive-receipt/1.0', 'previous_receipt_hash',
  'derived_status', 'current_execution_id', 'execution-seal-receipt/1.0',
  'source-fence/1.1', 'reuse-source-fence/1.1', 'session-source',
  'permanent Session seal', 'Session-global', 'session/1.x',
];

const GUIDE_REQUIREMENTS = [
  {
    id: 'docs.search.zh',
    path: 'guide/search-system-guide.md',
    tokens: ['`session/1.3` + `command-run/1.3`', '1.0-1.3', 'cache v8', 'MAESTRO_SEARCH_COMPILED_POSTINGS', 'fail closed'],
  },
  {
    id: 'docs.search.en',
    path: 'guide/search-system-guide.en.md',
    tokens: ['`session/1.3` + `command-run/1.3`', '1.0-1.3', 'cache v8', 'MAESTRO_SEARCH_COMPILED_POSTINGS', 'fail closed'],
  },
  {
    id: 'docs.architecture',
    path: 'guide/session-run-architecture.md',
    tokens: [
      'session/1.3', 'command-run/1.3', 'command-run/1.4', 'execution/1.0',
      'execution-lease/1.0', 'run-response/1.0', 'run-response/1.1',
      'session_statusless=true', 'opaque/best-effort read compatibility', 'fail-closed mutation boundary',
      ...WAVE2_GUIDE_TOKENS,
      ...REQUIRED_OPERATIONS,
    ],
  },
  {
    id: 'docs.structure',
    path: 'guide/session-run-structure-guide.md',
    tokens: [
      'session/1.3', 'command-run/1.3', 'command-run/1.4', 'execution/1.0',
      'execution-lease/1.0', 'run-response/1.0', 'run-response/1.1',
      '--expected-execution-revision', '--lease-epoch', 'session_statusless=true',
      'opaque/best-effort read compatibility', 'fail-closed mutation boundary',
      'brief-result/1.1', 'knowledge_context', ...WAVE2_GUIDE_TOKENS, ...REQUIRED_OPERATIONS,
    ],
  },
  {
    id: 'docs.cli.zh',
    path: 'guide/cli-commands-guide.md',
    tokens: [
      'session/1.3', 'command-run/1.3', 'command-run/1.4', 'execution/1.0',
      'execution-lease/1.0', 'run-response/1.0', 'run-response/1.1',
      'maestro capabilities --json', 'maestro execution start',
      '--expected-execution-revision', '--lease-epoch', '--claim-output', 'session_statusless=true',
      'opaque/best-effort read compatibility', 'fail-closed mutation boundary',
      'brief-result/1.1', 'knowledge_context', '绝不会静默切换默认值', ...WAVE2_GUIDE_TOKENS,
      'maestro knowledge stage', 'maestro knowledge record', 'maestro knowledge review',
      'maestro knowledge promote',
      ...REQUIRED_OPERATIONS,
    ],
  },
  {
    id: 'docs.cli.en',
    path: 'guide/cli-commands-guide.en.md',
    tokens: [
      'session/1.3', 'command-run/1.3', 'command-run/1.4', 'execution/1.0',
      'execution-lease/1.0', 'run-response/1.0', 'run-response/1.1',
      'maestro capabilities --json', 'maestro execution start',
      '--expected-execution-revision', '--lease-epoch', '--claim-output', 'session_statusless=true',
      'opaque/best-effort read compatibility', 'fail-closed mutation boundary',
      'There is no silent default switch.',
      ...WAVE2_GUIDE_TOKENS,
      ...REQUIRED_OPERATIONS,
    ],
  },
  {
    id: 'docs.knowledge-wave2-supersession',
    path: 'docs/knowledge-system-architecture.md',
    tokens: [
      'Wave 2 supersession', 'session-source',
      'promotion without a permanent Session seal',
      'execution-seal-receipt/1.0', 'Run-source candidate',
    ],
  },
  {
    id: 'docs.prepare-authoring',
    path: 'guide/prepare-workflow-authoring-spec.md',
    tokens: ['brief-result/1.1', 'briefResultV11Schema', 'knowledge reconciliation card', 'contract_version: 2.1', 'ARTIFACT_SCHEMA_UNKNOWN'],
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

const sourceCache = new Map();

function source(relativePath) {
  if (sourceCache.has(relativePath)) return sourceCache.get(relativePath);
  const text = read(relativePath);
  const parsed = text === null
    ? null
    : ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  sourceCache.set(relativePath, parsed);
  return parsed;
}

function findVariable(relativePath, name) {
  const parsed = source(relativePath);
  if (!parsed) return null;
  let initializer = null;
  const visit = node => {
    if (initializer) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      initializer = node.initializer ?? null;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return initializer;
}

function unwrapExpression(node) {
  let current = node;
  while (current && (ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current))) current = current.expression;
  return current;
}

function callChain(node) {
  const calls = [];
  let current = unwrapExpression(node);
  while (current && ts.isCallExpression(current)) {
    const expression = current.expression;
    if (ts.isPropertyAccessExpression(expression)) {
      calls.push({ name: expression.name.text, args: current.arguments, node: current });
      current = unwrapExpression(expression.expression);
    } else {
      break;
    }
  }
  return calls;
}

function objectFromCallChain(node) {
  for (const call of callChain(node)) {
    const candidate = unwrapExpression(call.args[0]);
    if (call.name === 'object' && candidate && ts.isObjectLiteralExpression(candidate)) return candidate;
  }
  return null;
}

function propertyName(property) {
  if (!property.name) return null;
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)) {
    return property.name.text;
  }
  return null;
}

function objectProperty(object, name) {
  if (!object) return null;
  const property = object.properties.find(item => ts.isPropertyAssignment(item) && propertyName(item) === name);
  return property && ts.isPropertyAssignment(property) ? unwrapExpression(property.initializer) : null;
}

function literalValue(node) {
  const value = unwrapExpression(node);
  if (!value) return undefined;
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  if (ts.isNumericLiteral(value)) return Number(value.text);
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (value.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(value)) return value.elements.map(literalValue);
  if (ts.isObjectLiteralExpression(value)) {
    return Object.fromEntries(value.properties
      .filter(ts.isPropertyAssignment)
      .map(property => [propertyName(property), literalValue(property.initializer)]));
  }
  return undefined;
}

function zodLiteral(relativePath, variableName, property = 'schema_version') {
  const initializer = findVariable(relativePath, variableName);
  let result = null;
  const visit = node => {
    if (result !== null) return;
    if (ts.isPropertyAssignment(node) && propertyName(node) === property) {
      const literalCall = callChain(node.initializer).find(call => call.name === 'literal');
      const value = literalCall ? literalValue(literalCall.args[0]) : undefined;
      if (typeof value === 'string') result = value;
    }
    ts.forEachChild(node, visit);
  };
  if (initializer) visit(initializer);
  return result;
}

function zodObjectContract(relativePath, variableName) {
  const initializer = findVariable(relativePath, variableName);
  const properties = new Set();
  const calls = [];
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      calls.push(node.expression.name.text);
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        const name = propertyName(property);
        if (name) properties.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  if (initializer) visit(initializer);
  return { properties: [...properties], calls };
}

function zodArray(relativePath, variableName, callName = 'enum') {
  const initializer = findVariable(relativePath, variableName);
  const call = callChain(initializer).find(candidate => candidate.name === callName);
  return call ? literalValue(call.args[0]) ?? null : null;
}

function zodEnumMembers(relativePath, variableName, seen = new Set()) {
  if (seen.has(variableName)) return [];
  seen.add(variableName);
  const initializer = findVariable(relativePath, variableName);
  const call = callChain(initializer).find(candidate => candidate.name === 'enum');
  const array = call ? unwrapExpression(call.args[0]) : null;
  if (!array || !ts.isArrayLiteralExpression(array)) return [];
  const values = [];
  for (const element of array.elements) {
    if (ts.isSpreadElement(element)
      && ts.isPropertyAccessExpression(element.expression)
      && element.expression.name.text === 'options'
      && ts.isIdentifier(element.expression.expression)) {
      values.push(...zodEnumMembers(relativePath, element.expression.expression.text, seen));
      continue;
    }
    const value = literalValue(element);
    if (typeof value === 'string') values.push(value);
  }
  return values;
}

function zodPropertyCalls(relativePath, variableName, property) {
  const initializer = findVariable(relativePath, variableName);
  let calls = [];
  const visit = node => {
    if (ts.isPropertyAssignment(node) && propertyName(node) === property) {
      calls = callChain(node.initializer).map(call => call.name);
      return;
    }
    if (calls.length === 0) ts.forEachChild(node, visit);
  };
  if (initializer) visit(initializer);
  return calls;
}

function zodPropertyCallArgument(relativePath, variableName, property, callName) {
  const initializer = findVariable(relativePath, variableName);
  let result = null;
  const visit = node => {
    if (result !== null) return;
    if (ts.isPropertyAssignment(node) && propertyName(node) === property) {
      const call = callChain(node.initializer).find(candidate => candidate.name === callName);
      if (call) result = literalValue(call.args[0]) ?? null;
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (initializer) visit(initializer);
  return result;
}

function unionMembers(relativePath, variableName) {
  const initializer = findVariable(relativePath, variableName);
  const call = callChain(initializer).find(candidate => candidate.name === 'union');
  const array = call ? unwrapExpression(call.args[0]) : null;
  if (!array || !ts.isArrayLiteralExpression(array)) return [];
  return array.elements.map(element => ts.isIdentifier(unwrapExpression(element)) ? unwrapExpression(element).text : null);
}

function discriminatedUnionPropertyMembers(
  relativePath,
  variableName,
  discriminator,
  discriminatorValue,
  property,
) {
  const initializer = findVariable(relativePath, variableName);
  const unionCall = callChain(initializer).find(candidate => candidate.name === 'union');
  const branches = unionCall ? unwrapExpression(unionCall.args[0]) : null;
  if (!branches || !ts.isArrayLiteralExpression(branches)) return [];
  for (const branch of branches.elements) {
    const extendCall = callChain(branch).find(candidate => candidate.name === 'extend');
    const object = extendCall ? unwrapExpression(extendCall.args[0]) : null;
    if (!object || !ts.isObjectLiteralExpression(object)) continue;
    const discriminatorNode = objectProperty(object, discriminator);
    const discriminatorCall = callChain(discriminatorNode).find(candidate => candidate.name === 'literal');
    if (literalValue(discriminatorCall?.args[0]) !== discriminatorValue) continue;
    const propertyNode = objectProperty(object, property);
    const propertyCall = callChain(propertyNode).find(candidate => candidate.name === 'union');
    const members = propertyCall ? unwrapExpression(propertyCall.args[0]) : null;
    if (!members || !ts.isArrayLiteralExpression(members)) return [];
    return members.elements.map(element => {
      const member = unwrapExpression(element);
      return ts.isIdentifier(member) ? member.text : null;
    });
  }
  return [];
}

function parsedObjectArgument(relativePath, functionName, parserName) {
  const parsed = source(relativePath);
  if (!parsed) return null;
  let functionNode = null;
  let object = null;
  const visit = node => {
    if (!functionNode && ts.isFunctionDeclaration(node) && node.name?.text === functionName) functionNode = node;
    if (functionNode && !object && ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'parse'
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === parserName) {
      const candidate = unwrapExpression(node.arguments[0]);
      if (candidate && ts.isObjectLiteralExpression(candidate)) object = candidate;
    }
    if (!object) ts.forEachChild(node, visit);
  };
  visit(parsed);
  return object ? literalValue(object) : null;
}

function arrayLiteralFromVariable(relativePath, variableName) {
  const initializer = unwrapExpression(findVariable(relativePath, variableName));
  const frozen = initializer && ts.isCallExpression(initializer)
    && ts.isPropertyAccessExpression(initializer.expression)
    && initializer.expression.expression.getText() === 'Object'
    && initializer.expression.name.text === 'freeze'
    ? unwrapExpression(initializer.arguments[0])
    : initializer;
  return frozen && ts.isArrayLiteralExpression(frozen) ? literalValue(frozen) : null;
}

function functionAst(relativePath, functionName) {
  const parsed = source(relativePath);
  if (!parsed) return null;
  let match = null;
  const visit = node => {
    if (!match && ts.isFunctionDeclaration(node) && node.name?.text === functionName) match = node;
    if (!match) ts.forEachChild(node, visit);
  };
  visit(parsed);
  return match;
}

function functionPropertyLiterals(relativePath, functionName, property) {
  const fn = functionAst(relativePath, functionName);
  if (!fn) return [];
  const values = [];
  const visit = node => {
    if (ts.isPropertyAssignment(node) && propertyName(node) === property) {
      const value = literalValue(node.initializer);
      if (value !== undefined) values.push(value);
    }
    ts.forEachChild(node, visit);
  };
  visit(fn);
  return values;
}

function functionObjectKeys(relativePath, functionName) {
  const fn = functionAst(relativePath, functionName);
  if (!fn) return [];
  const keys = new Set();
  const visit = node => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        const name = propertyName(property);
        if (name) keys.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(fn);
  return [...keys];
}

function callStringArguments(relativePath, functionName) {
  const parsed = source(relativePath);
  if (!parsed) return [];
  const values = [];
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === functionName) {
      const value = literalValue(node.arguments.at(-1));
      if (typeof value === 'string') values.push(value);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return values;
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

function explicitlyHandlesVersion(text, functionName, version) {
  const source = block(text, `function ${functionName}`, '\nfunction ');
  return source.includes(`raw.schema_version === '${version}'`)
    || source.includes(`raw.schema_version === "${version}"`);
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

for (const result of inspectExecutionPromptSuite(root)) {
  addCheck(
    `prompt.execution.${result.id}`,
    { path: result.path, errors: result.errors },
    { errors: [] },
    result.errors.length === 0,
  );
}
const promptSupport = inspectExecutionPromptSupport(root);
addCheck(
  'prompt.execution.support-sources',
  promptSupport.map(result => ({ id: result.id, path: result.path, errors: result.errors })),
  { errors: [] },
  promptSupport.every(result => result.errors.length === 0),
);

const writerPath = 'src/run/schemas.ts';
const sessionWriterVersion = zodLiteral(writerPath, 'sessionStateV13Schema');
const legacyRunWriterVersion = zodLiteral(writerPath, 'commandRunV13Schema');
addCheck('writer.session.current', sessionWriterVersion, 'session/1.3', sessionWriterVersion === 'session/1.3');
addCheck(
  'writer.command-run.legacy-default',
  legacyRunWriterVersion,
  'command-run/1.3',
  legacyRunWriterVersion === 'command-run/1.3',
);

const sessionV20Contract = zodObjectContract(writerPath, 'sessionStateV20Schema');
const sessionWriterSelection = zodArray(writerPath, 'sessionSchemaWriterSchema');
const defaultSessionSelection = literalValue(findVariable('src/run/defaults.ts', 'DEFAULT_SESSION_SCHEMA_SELECTION'));
const expectedDefaultSessionSelection = {
  schema_version: 'session-schema-selection/1.0',
  writer: 'session/3.0',
  features: { session_statusless: false },
};
addCheck(
  'writer.session.statusless-explicit',
  {
    version: zodLiteral(writerPath, 'sessionStateV20Schema'),
    strict: sessionV20Contract.calls.includes('strict'),
    properties: sessionV20Contract.properties,
  },
  {
    version: 'session/2.0',
    strict: true,
    requiredProperties: ['current_execution_id', 'latest_execution_id', 'archived_at', 'archived_by'],
    forbiddenProperties: ['status', 'active_run_id'],
  },
  zodLiteral(writerPath, 'sessionStateV20Schema') === 'session/2.0'
    && sessionV20Contract.calls.includes('strict')
    && ['current_execution_id', 'latest_execution_id', 'archived_at', 'archived_by']
      .every(name => sessionV20Contract.properties.includes(name))
    && ['status', 'active_run_id'].every(name => !sessionV20Contract.properties.includes(name)),
);
addCheck(
  'writer.session.selection-default',
  { supported: sessionWriterSelection, default: defaultSessionSelection },
  { supported: ['session/1.3', 'session/2.0', 'session/3.0'], default: expectedDefaultSessionSelection },
  sameValues(sessionWriterSelection ?? [], ['session/1.3', 'session/2.0', 'session/3.0'])
    && JSON.stringify(defaultSessionSelection) === JSON.stringify(expectedDefaultSessionSelection),
);

const executionStateContract = zodObjectContract(writerPath, 'executionStateSchema');
const executionLeaseContract = zodObjectContract(writerPath, 'executionLeaseSchema');
const executionAlias = unwrapExpression(findVariable(writerPath, 'executionSchema'));
addCheck(
  'writer.execution.strict',
  {
    version: zodLiteral(writerPath, 'executionStateSchema'),
    strict: executionStateContract.calls.includes('strict'),
    canonical: ts.isIdentifier(executionAlias) ? executionAlias.text : null,
  },
  { version: 'execution/1.0', strict: true, canonical: 'executionStateSchema' },
  zodLiteral(writerPath, 'executionStateSchema') === 'execution/1.0'
    && executionStateContract.calls.includes('strict')
    && ts.isIdentifier(executionAlias)
    && executionAlias.text === 'executionStateSchema',
);
addCheck(
  'writer.execution-lease.strict',
  {
    version: zodLiteral(writerPath, 'executionLeaseSchema'),
    strict: executionLeaseContract.calls.includes('strict'),
  },
  { version: 'execution-lease/1.0', strict: true },
  zodLiteral(writerPath, 'executionLeaseSchema') === 'execution-lease/1.0'
    && executionLeaseContract.calls.includes('strict'),
);

const commandRunV14Contract = zodObjectContract(writerPath, 'commandRunV14Schema');
const commandRunReaderMembers = unionMembers(writerPath, 'commandRunReadSchema');
const expectedRunReaderMembers = [
  'commandRunV14Schema', 'commandRunV13Schema', 'commandRunV12Schema',
  'commandRunV11Schema', 'commandRunV1Schema', 'commandRunUnknownSchema',
];
const generationCalls = zodPropertyCalls(writerPath, 'commandRunV14Schema', 'generation');
addCheck(
  'writer.command-run.execution-explicit',
  {
    version: zodLiteral(writerPath, 'commandRunV14Schema'),
    properties: commandRunV14Contract.properties,
    generationCalls,
    readerMembers: commandRunReaderMembers,
  },
  {
    version: 'command-run/1.4',
    requiredProperties: ['schema_version', 'execution_id', 'generation'],
    generationCalls: ['positive', 'int', 'number'],
    readerMembers: expectedRunReaderMembers,
  },
  zodLiteral(writerPath, 'commandRunV14Schema') === 'command-run/1.4'
    && ['schema_version', 'execution_id', 'generation'].every(name => commandRunV14Contract.properties.includes(name))
    && sameValues(generationCalls, ['positive', 'int', 'number'])
    && sameValues(commandRunReaderMembers, expectedRunReaderMembers),
);

const createRunSchemaVersions = functionPropertyLiterals('src/run/runtime.ts', 'createRun', 'schema_version');
const executionCreateKeys = functionObjectKeys('src/run/runtime.ts', 'createExecutionRun');
addCheck(
  'runtime.command-run.writer-split',
  {
    createRunSchemaVersions,
    executionDelegatesAuthority: executionCreateKeys.includes('execution'),
    sessionVersion: sessionWriterVersion,
  },
  {
    createRunSchemaVersions: ['command-run/1.3', 'command-run/1.4'],
    executionDelegatesAuthority: true,
    sessionVersion: 'session/1.3',
  },
  createRunSchemaVersions.includes('command-run/1.3')
    && createRunSchemaVersions.includes('command-run/1.4')
    && executionCreateKeys.includes('execution')
    && sessionWriterVersion === 'session/1.3',
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

const v3SessionReader = explicitlyHandlesVersion(wikiReader, 'normalizeRunModeSession', 'session/3.0');
const v3RunReader = explicitlyHandlesVersion(wikiReader, 'normalizeRunModeRun', 'run/3.0');
addCheck(
  'reader.session.v3',
  v3SessionReader,
  true,
  v3SessionReader,
);
addCheck(
  'reader.run.v3',
  v3RunReader,
  true,
  v3RunReader,
);

const wikiIndexer = read('dashboard/src/server/wiki/wiki-indexer.ts');
const cacheVersion = Number(wikiIndexer?.match(/const\s+SEARCH_CACHE_VERSION\s*=\s*(\d+)\s*;/)?.[1] ?? Number.NaN);
addCheck('cache.search.version', Number.isNaN(cacheVersion) ? null : cacheVersion, 9, cacheVersion === 9);

const protocolPath = 'src/run/protocol-schemas.ts';
const legacyOperations = zodEnumMembers(protocolPath, 'runOperationSchema');
const allV11Operations = zodEnumMembers(protocolPath, 'runOperationV11Schema');
const additiveOperations = allV11Operations.filter(operation => !legacyOperations.includes(operation));
const responseSchemaContract = {
  legacyVersion: zodLiteral(protocolPath, 'responseCommonSchema'),
  executionVersion: zodLiteral(protocolPath, 'responseCommonV11Schema'),
  minimalV3Version: zodLiteral(protocolPath, 'responseCommonV12Schema'),
  v10Members: unionMembers(protocolPath, 'runResponseV10Schema'),
  v11Members: unionMembers(protocolPath, 'runResponseV11Schema'),
  v12Members: unionMembers(protocolPath, 'runResponseV12Schema'),
  compatibilityMembers: unionMembers(protocolPath, 'runResponseSchema'),
};
addCheck('response.operations.legacy', legacyOperations, LEGACY_OPERATIONS, sameValues(legacyOperations, LEGACY_OPERATIONS));
addCheck(
  'response.operations.execution-additive',
  additiveOperations,
  EXECUTION_OPERATIONS,
  sameValues(additiveOperations, EXECUTION_OPERATIONS),
);
addCheck(
  'response.schemas.compatibility',
  responseSchemaContract,
  {
    legacyVersion: 'run-response/1.0',
    executionVersion: 'run-response/1.1',
    minimalV3Version: 'run-response/1.2',
    v10Members: ['runResponseSuccessSchema', 'runResponseErrorSchema'],
    v11Members: ['runResponseSuccessV11Schema', 'runResponseErrorV11Schema'],
    v12Members: ['runResponseSuccessV12Schema', 'runResponseErrorV12Schema'],
    compatibilityMembers: ['runResponseV12Schema', 'runResponseV11Schema', 'runResponseV10Schema'],
  },
  responseSchemaContract.legacyVersion === 'run-response/1.0'
    && responseSchemaContract.executionVersion === 'run-response/1.1'
    && responseSchemaContract.minimalV3Version === 'run-response/1.2'
    && sameValues(responseSchemaContract.v10Members, ['runResponseSuccessSchema', 'runResponseErrorSchema'])
    && sameValues(responseSchemaContract.v11Members, ['runResponseSuccessV11Schema', 'runResponseErrorV11Schema'])
    && sameValues(responseSchemaContract.v12Members, ['runResponseSuccessV12Schema', 'runResponseErrorV12Schema'])
    && sameValues(responseSchemaContract.compatibilityMembers, ['runResponseV12Schema', 'runResponseV11Schema', 'runResponseV10Schema']),
);

const capabilitiesCommands = read('src/commands/capabilities.ts');
const capabilityFeatureKeys = [
  'execution_generation', 'core_execution_lease', 'execution_handoff', 'session_statusless',
  'legacy_session_aliases', 'session_run_minimal_v3', 'entity_revision_cas',
  'participant_identity', 'request_receipts_v2', 'execution_lease', 'operation_registry',
  'artifact_compatibility_v1', 'atomic_run_complete_seal', 'generation_scoped_seal_receipts',
];
const legacyCapabilityFeatures = new Set([
  'execution_generation', 'core_execution_lease', 'execution_handoff', 'session_statusless',
  'legacy_session_aliases', 'execution_lease',
]);
const universalCapabilityFeatures = new Set([
  'artifact_compatibility_v1', 'atomic_run_complete_seal', 'generation_scoped_seal_receipts',
]);
const capabilityContract = {
  schema_version: zodLiteral(protocolPath, 'maestroCapabilitiesSchema'),
  session_schema_writes: {
    writer_scoped: capabilitiesCommands?.includes("const sessionSchemaWrites = writer === 'session/3.0'") ?? false,
    v3_branch: capabilitiesCommands?.includes("['session/3.0']") ?? false,
    v2_branch: capabilitiesCommands?.includes("['session/1.3', 'session/2.0']") ?? false,
    v13_branch: capabilitiesCommands?.includes("['session/1.3']") ?? false,
  },
  run_response_writes: functionPropertyLiterals(
    'src/commands/capabilities.ts', 'registerCapabilitiesCommand', 'run_response_writes',
  )[0] ?? null,
  v3_writer_switch: capabilitiesCommands?.includes("const v3 = writer === 'session/3.0';") ?? false,
  execution_writer_switch: capabilitiesCommands?.includes("execution_schema_writes: v3 ? [] : ['execution/1.0']") ?? false,
  feature_switches: capabilityFeatureKeys.map(key => capabilitiesCommands?.includes(
    `${key}: ${key === 'operation_registry'
      ? 'false'
      : universalCapabilityFeatures.has(key)
        ? 'true'
        : legacyCapabilityFeatures.has(key)
          ? '!v3'
          : 'v3Ready'}`,
  ) ?? false),
};
const expectedCapabilityContract = {
  schema_version: 'maestro-capabilities/1.0',
  session_schema_writes: {
    writer_scoped: true,
    v3_branch: true,
    v2_branch: true,
    v13_branch: true,
  },
  run_response_writes: ['run-response/1.0', 'run-response/1.1', 'run-response/1.2'],
  v3_writer_switch: true,
  execution_writer_switch: true,
  feature_switches: capabilityFeatureKeys.map(() => true),
};
addCheck(
  'capabilities.exact',
  capabilityContract,
  expectedCapabilityContract,
  JSON.stringify(capabilityContract) === JSON.stringify(expectedCapabilityContract),
);

const executionCommands = read('src/commands/execution.ts');
const protocolSchemas = read(protocolPath);
const receiptFenceContract = {
  sourceFence: zodLiteral(protocolPath, 'sourceFenceV11Schema'),
  reuseAssessment: zodLiteral(protocolPath, 'reuseAssessmentV11Schema'),
  reuseSourceFence: block(
    protocolSchemas,
    'export const reuseAssessmentV11Schema',
    '/** Additive compatibility reader; reuseAssessmentSchema remains the strict 1.0 shape. */',
  ).includes("schema_version: z.literal('reuse-source-fence/1.1')"),
  executionSealReceipt: zodLiteral(protocolPath, 'executionSealReceiptSchema'),
  sessionArchiveReceipt: zodLiteral(protocolPath, 'sessionArchiveReceiptSchema'),
};
addCheck(
  'response.receipt-fences.wave2',
  receiptFenceContract,
  {
    sourceFence: 'source-fence/1.1',
    reuseAssessment: 'reuse-assessment/1.1',
    reuseSourceFence: true,
    executionSealReceipt: 'execution-seal-receipt/1.0',
    sessionArchiveReceipt: 'session-archive-receipt/1.0',
  },
  receiptFenceContract.sourceFence === 'source-fence/1.1'
    && receiptFenceContract.reuseAssessment === 'reuse-assessment/1.1'
    && receiptFenceContract.reuseSourceFence
    && receiptFenceContract.executionSealReceipt === 'execution-seal-receipt/1.0'
    && receiptFenceContract.sessionArchiveReceipt === 'session-archive-receipt/1.0',
);

const cli = read('src/cli.ts');
const executionCliContract = {
  executionLoader: cli?.includes("execution:  async () => (await import('./commands/execution.js')).registerExecutionCommand") ?? false,
  capabilitiesLoader: cli?.includes("capabilities: async () => (await import('./commands/capabilities.js')).registerCapabilitiesCommand") ?? false,
  executionCommand: executionCommands?.includes("program.command('execution')") ?? false,
  completeTree: [
    ".command('start')", ".command('attach')", ".command('status')", ".command('pause')",
    ".command('resolve')", ".command('resume')", ".command('seal')", ".command('handoff')",
    ".command('prepare')", ".command('accept')", ".command('cancel')", ".command('lease')",
    ".command('heartbeat')", ".command('release')", ".command('recover')",
  ].every(token => executionCommands?.includes(token)),
};
addCheck(
  'cli.execution.registration',
  executionCliContract,
  { executionLoader: true, capabilitiesLoader: true, executionCommand: true, completeTree: true },
  Object.values(executionCliContract).every(Boolean),
);
const knowledgeCardVersion = schemaLiteral(
  protocolSchemas,
  'export const knowledgeReconciliationCardSchema',
  'export const briefResultV10Schema',
);
const briefResultReaderMembers = discriminatedUnionPropertyMembers(
  protocolPath,
  'runResponseSuccessSchema',
  'operation',
  'brief',
  'result',
);
const expectedBriefResultReaderMembers = [
  'briefResultV10Schema',
  'briefResultV11Schema',
  'briefResultV12Schema',
];
addCheck(
  'brief.knowledge-context.schema',
  {
    version: knowledgeCardVersion,
    attached: block(
      protocolSchemas,
      'export const briefResultV11Schema',
      'const recallExactCandidateSchema',
    ).includes('knowledge_context: knowledgeReconciliationCardSchema'),
    readerMembers: briefResultReaderMembers,
    legacyAccepted: briefResultReaderMembers.includes('briefResultV10Schema'),
  },
  {
    version: 'knowledge-reconciliation-card/1.0',
    attached: true,
    readerMembers: expectedBriefResultReaderMembers,
    legacyAccepted: true,
  },
  knowledgeCardVersion === 'knowledge-reconciliation-card/1.0'
    && block(
      protocolSchemas,
      'export const briefResultV11Schema',
      'const recallExactCandidateSchema',
    ).includes('knowledge_context: knowledgeReconciliationCardSchema')
    && sameValues(briefResultReaderMembers, expectedBriefResultReaderMembers)
    && briefResultReaderMembers.includes('briefResultV10Schema'),
);

const knowledgeCommands = read('src/commands/knowledge.ts');
const knowledgeLifecycleCli = {
  record: knowledgeCommands?.includes(".command('record')") ?? false,
  stage: knowledgeCommands?.includes(".command('stage')") ?? false,
  reconcile: knowledgeCommands?.includes(".command('reconcile')") ?? false,
  review: knowledgeCommands?.includes(".command('review')") ?? false,
  resolve: knowledgeCommands?.includes(".command('resolve')") ?? false,
  session: knowledgeCommands?.includes(".command('session')") ?? false,
  promote: knowledgeCommands?.includes(".command('promote')") ?? false,
};
const expectedKnowledgeLifecycleCli = {
  record: true,
  stage: true,
  reconcile: true,
  review: true,
  resolve: false,
  session: false,
  promote: true,
};
addCheck(
  'cli.knowledge-lifecycle',
  knowledgeLifecycleCli,
  expectedKnowledgeLifecycleCli,
  JSON.stringify(knowledgeLifecycleCli) === JSON.stringify(expectedKnowledgeLifecycleCli),
);

const runtime = read('src/run/runtime.ts');
const runMode = read('workflows/run-mode.md');
const knowledgeCompletionContract = {
  receipt: runtime?.includes('knowledgeCandidateReceipt(prepared.sessionId, knowledgeDelta)') ?? false,
  finishSignal: runtime?.includes('--signal cited|validated|contradicted --signal-ids <knowledge-ids>') ?? false,
  finishStage: runtime?.includes('maestro knowledge stage knowhow') ?? false,
  freshnessFence: runtime?.includes('knowledge candidates or project corpus changed after reconciliation') ?? false,
  reconciliationReceipt: runtime?.includes('reconciliation: reconciliationSummary(prepared.knowledgeReconciliation)') ?? false,
  finishReviewResolve: (runtime?.includes('maestro knowledge promote') && runtime?.includes('--resolve')) ?? false,
  promptReceipt: runMode?.includes('knowledge-candidate-receipt/1.0') ?? false,
  promptReconciliation: runMode?.includes('knowledge-reconciliation/1.0') ?? false,
  promptNoDirectWrite: runMode?.includes('Routine Run completion MUST NOT call `maestro spec add`') ?? false,
};
addCheck(
  'runtime.prompt.knowledge-completion',
  knowledgeCompletionContract,
  {
    receipt: true,
    finishSignal: true,
    finishStage: true,
    freshnessFence: true,
    reconciliationReceipt: true,
    finishReviewResolve: true,
    promptReceipt: true,
    promptReconciliation: true,
    promptNoDirectWrite: true,
  },
  Object.values(knowledgeCompletionContract).every(Boolean),
);

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

const planCommands = read('src/commands/plan.ts');
const planPublishMachineHandler = {
  command: planCommands?.includes(".command('publish <path>')") ?? false,
  json: planCommands?.includes(".option('--json'") ?? false,
  business: planCommands?.includes('const result = publishPlan({') ?? false,
  success: planCommands?.includes("operation: 'plan-publish'")
    && planCommands.includes('createRunResponseSuccess({'),
  error: planCommands?.includes('createRunResponseError({') ?? false,
};
addCheck(
  'cli.plan-publish.machine-handler',
  planPublishMachineHandler,
  { command: true, json: true, business: true, success: true, error: true },
  Object.values(planPublishMachineHandler).every(Boolean),
);

const expectedReleaseProofs = [
  'capabilities-exact',
  'v3-capabilities-branch',
  'v3-workflow-root-equals-routing',
  'v3-help-json-catalog',
  'v2-help-run-compatibility',
  'v3-retired-execution-structured-response',
  'v3-run-complete-requires-advance',
  'statusless-create-migration-gate',
  'archive-unarchive-cas-receipt-chain',
  'lease-acquisition-handoff-stale-release-seal',
  'execution-seal-lock-release-failure-ordering',
  'execution-lease-release-lock-release-failure-ordering',
  'execution-seal-receipt-source-fence-1.1',
  'execution-aware-create-complete',
  'execution-aware-next',
  'plan-publish-execution-run-audit-redaction',
  'plan-publish-execution-applied-replayed-fences',
  'plan-publish-empty-execution-bootstrap-chain',
  'plan-publish-legacy-1.x-fallback',
  'session-seal-execution-alias-applied-replayed-conflict',
  'session-seal-legacy-1.x-fallback',
  'run-seal-session-execution-alias-applied-replayed-conflict',
  'run-seal-session-legacy-1.x-fallback',
  'complete-needs-retry',
  'complete-blocked',
  'decide-terminal-escalate-replay',
  'commander-real-secret-redaction',
  'legacy-1.0-create',
  'session-source-promotion-without-session-seal',
  'transition-secret-persistence-redaction',
];
const declaredReleaseProofs = arrayLiteralFromVariable(
  'scripts/check-session-run-release-machine.mjs',
  'REQUIRED_BEHAVIOR_PROOFS',
) ?? [];
const recordedReleaseProofs = callStringArguments(
  'scripts/check-session-run-release-machine.mjs',
  'recordProof',
);
const releaseMachineCoverage = {
  declared: declaredReleaseProofs,
  recorded: recordedReleaseProofs,
};
addCheck(
  'release-machine.coverage',
  releaseMachineCoverage,
  { declared: expectedReleaseProofs, recorded: expectedReleaseProofs },
  sameValues(declaredReleaseProofs, expectedReleaseProofs)
    && sameValues([...recordedReleaseProofs].sort(), [...expectedReleaseProofs].sort()),
);

const focusedReleaseTests = callStringArguments(
  'scripts/check-session-run-release-machine.mjs',
  'runFocusedVitest',
);
addCheck(
  'release-machine.focused-fault-injection',
  focusedReleaseTests,
  EXPECTED_FOCUSED_RELEASE_TESTS,
  sameValues(focusedReleaseTests, EXPECTED_FOCUSED_RELEASE_TESTS),
);

const releaseMachineText = read('scripts/check-session-run-release-machine.mjs');
const missingReleaseMachineOperationTokens = releaseMachineText === null
  ? [...REQUIRED_RELEASE_MACHINE_OPERATION_TOKENS]
  : REQUIRED_RELEASE_MACHINE_OPERATION_TOKENS.filter(token => !releaseMachineText.includes(token));
addCheck(
  'release-machine.operation-tokens',
  { missing: missingReleaseMachineOperationTokens },
  { missing: [] },
  missingReleaseMachineOperationTokens.length === 0,
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

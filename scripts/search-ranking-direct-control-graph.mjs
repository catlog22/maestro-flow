import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map(name => `node:${name}`),
]);
const SOURCE_EXTENSIONS = Object.freeze([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
]);
const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);
const ROOTS_KEYS = Object.freeze([
  'schema_version',
  'package_scripts',
  'package_bins',
  'entrypoints',
  'native',
  'registered_workflow',
  'exclusions',
]);
const EDGE_CLASSES = Object.freeze([
  'package-script-token',
  'js-ts-static-import-export',
  'js-ts-literal-dynamic-import',
  'native-manifest',
  'cargo-target-module-lock',
  'workflow-run-artifact-receipt',
  'literal-test-command-array',
  'generated-output-source',
]);

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const defaultRootsPath = join(
  repoRoot,
  'scripts',
  'search-ranking-direct-control-roots.json',
);

let cachedTypeScript;

function typeScript() {
  cachedTypeScript ??= require('typescript');
  return cachedTypeScript;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DirectControlGraphError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new DirectControlGraphError(
      `${label} keys must be exactly ${expected.join(', ')}`,
    );
  }
}

function normalizedRelative(root, path, label) {
  const absolute = resolve(path);
  const rel = relative(root, absolute).replaceAll('\\', '/');
  if (!rel
      || rel === '..'
      || rel.startsWith('../')
      || isAbsolute(rel)
      || rel.split('/').includes('..')) {
    throw new DirectControlGraphError(`${label} escapes repository root: ${path}`);
  }
  return rel;
}

function normalizedDeclaredPath(path, label) {
  if (typeof path !== 'string'
      || path.length === 0
      || path.includes('\\')
      || path.startsWith('/')
      || /^[A-Za-z]:/.test(path)
      || path.split('/').includes('..')) {
    throw new DirectControlGraphError(`${label} is not a normalized repository path`);
  }
  return path;
}

function generatedSourceCounterpart(root, relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  const prefixes = [
    ['dist/src/', 'src/'],
    ['dashboard/dist-server/dashboard/', 'dashboard/'],
    ['dashboard/dist-server/', ''],
  ];
  const prefix = prefixes.find(([from]) => normalized.startsWith(from));
  if (!prefix) return null;
  const [, targetPrefix] = prefix;
  const suffix = normalized.slice(prefix[0].length);
  const extension = extname(suffix);
  const stem = extension ? suffix.slice(0, -extension.length) : suffix;
  const candidates = extension === '.js'
    ? ['.ts', '.tsx', '.mts', '.cts', '.js']
    : [extension];
  for (const candidateExtension of candidates) {
    const candidate = `${targetPrefix}${stem}${candidateExtension}`;
    if (isRegularFile(resolve(root, candidate))) return candidate;
  }
  return null;
}

function isGeneratedBuildOutputPath(path) {
  const normalized = path.replaceAll('\\', '/');
  return normalized.startsWith('dist/')
    || normalized.startsWith('dashboard/dist-server/');
}

function isRegularFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonical(value[key])]),
  );
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

export class DirectControlGraphError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'DirectControlGraphError';
    this.details = details;
  }
}

export function parseDirectControlRoots(raw) {
  let roots;
  try {
    roots = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
  } catch {
    throw new DirectControlGraphError('direct-control roots are not valid JSON');
  }
  exactKeys(roots, ROOTS_KEYS, 'direct-control roots');
  if (roots.schema_version !== 'search-ranking-direct-control-roots/1.0') {
    throw new DirectControlGraphError('unsupported direct-control roots schema');
  }
  for (const [name, value] of [
    ['package_scripts', roots.package_scripts],
    ['package_bins', roots.package_bins],
    ['entrypoints', roots.entrypoints],
  ]) {
    if (!Array.isArray(value)
        || value.length === 0
        || value.some(item => typeof item !== 'string' || item.length === 0)
        || new Set(value).size !== value.length) {
      throw new DirectControlGraphError(`${name} must contain unique non-empty strings`);
    }
  }
  exactKeys(roots.native, ['manifest', 'provenance', 'cargo_manifest'], 'native roots');
  exactKeys(
    roots.registered_workflow,
    ['template', 'path', 'workflow_id', 'default_blob_sha'],
    'registered workflow root',
  );
  if (!Number.isInteger(roots.registered_workflow.workflow_id)
      || roots.registered_workflow.workflow_id <= 0
      || !/^[a-f0-9]{40}$/.test(roots.registered_workflow.default_blob_sha)) {
    throw new DirectControlGraphError('registered workflow identity is invalid');
  }
  for (const [name, path] of Object.entries(roots.native)) {
    normalizedDeclaredPath(path, `native.${name}`);
  }
  normalizedDeclaredPath(roots.registered_workflow.template, 'registered workflow template');
  normalizedDeclaredPath(roots.registered_workflow.path, 'registered workflow path');
  for (const path of roots.entrypoints) normalizedDeclaredPath(path, 'entrypoint');
  if (!Array.isArray(roots.exclusions)) {
    throw new DirectControlGraphError('exclusions must be an array');
  }
  const exclusionPatterns = new Set();
  for (const exclusion of roots.exclusions) {
    exactKeys(exclusion, ['pattern', 'class', 'rationale'], 'exclusion');
    if (typeof exclusion.pattern !== 'string'
        || typeof exclusion.class !== 'string'
        || typeof exclusion.rationale !== 'string'
        || exclusion.pattern.length === 0
        || exclusion.class.length === 0
        || exclusion.rationale.trim().length < 24
        || exclusionPatterns.has(exclusion.pattern)
        || /expected[-_ ]?set|certificate membership|allowlist/i.test(exclusion.rationale)) {
      throw new DirectControlGraphError('exclusion must be unique, classified, and reasoned');
    }
    exclusionPatterns.add(exclusion.pattern);
  }
  return roots;
}

export function parseShellScript(text) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new DirectControlGraphError('package script must be a non-empty string');
  }
  const segments = [];
  let tokens = [];
  let token = '';
  let quote = null;
  let escaped = false;
  let operatorBefore = null;
  let tokenStarted = false;

  const pushToken = () => {
    if (!tokenStarted) return;
    tokens.push(token);
    token = '';
    tokenStarted = false;
  };
  const pushSegment = operatorAfter => {
    pushToken();
    if (tokens.length === 0) {
      throw new DirectControlGraphError('package script has an empty command segment');
    }
    segments.push({ operator_before: operatorBefore, tokens });
    tokens = [];
    operatorBefore = operatorAfter;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (escaped) {
      token += character;
      tokenStarted = true;
      escaped = false;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      escaped = true;
      tokenStarted = true;
      continue;
    }
    if (character === quote) {
      quote = null;
      tokenStarted = true;
      continue;
    }
    if (quote === "'") {
      token += character;
      tokenStarted = true;
      continue;
    }
    if (quote === '"') {
      if (character === '`' || (character === '$' && next === '(')) {
        throw new DirectControlGraphError('command substitution is unsupported');
      }
      if (character === '$') {
        throw new DirectControlGraphError('variable-built command or path is unsupported');
      }
      token += character;
      tokenStarted = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (character === '`' || (character === '$' && next === '(')) {
      throw new DirectControlGraphError('command substitution is unsupported');
    }
    if (character === '$') {
      throw new DirectControlGraphError('variable-built command or path is unsupported');
    }
    if (/\s/.test(character)) {
      pushToken();
      continue;
    }
    if (character === ';') {
      pushSegment(';');
      continue;
    }
    if (character === '&' || character === '|') {
      if (next === character) {
        pushSegment(`${character}${character}`);
        index += 1;
        continue;
      }
      throw new DirectControlGraphError(`unsupported shell operator: ${character}`);
    }
    if ('<>()'.includes(character)) {
      throw new DirectControlGraphError(`unsupported shell operator: ${character}`);
    }
    token += character;
    tokenStarted = true;
  }
  if (escaped || quote !== null) {
    throw new DirectControlGraphError('unterminated shell escape or quote');
  }
  pushSegment(null);
  for (const segment of segments) {
    if (segment.tokens.some(value => /%[A-Za-z_][A-Za-z0-9_]*%/.test(value))) {
      throw new DirectControlGraphError('variable-built command or path is unsupported');
    }
  }
  return segments;
}

function packageName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

function resolveImportMapping(specifier, packageJson) {
  for (const [key, target] of Object.entries(packageJson.imports ?? {})) {
    if (key === specifier && typeof target === 'string') return target;
    if (key.endsWith('/*')
        && specifier.startsWith(key.slice(0, -1))
        && typeof target === 'string'
        && target.includes('*')) {
      return target.replace('*', specifier.slice(key.length - 1));
    }
  }
  return null;
}

function candidatePaths(basePath) {
  const candidates = [basePath];
  const extension = extname(basePath);
  if (!extension) {
    candidates.push(...SOURCE_EXTENSIONS.map(value => `${basePath}${value}`));
    candidates.push(...SOURCE_EXTENSIONS.map(value => join(basePath, `index${value}`)));
  } else if (['.js', '.jsx', '.mjs', '.cjs'].includes(extension)) {
    const stem = basePath.slice(0, -extension.length);
    const replacements = extension === '.mjs'
      ? ['.mts', '.ts']
      : extension === '.cjs'
        ? ['.cts', '.ts']
        : ['.ts', '.tsx', '.mts', '.cts'];
    candidates.push(...replacements.map(value => `${stem}${value}`));
  }
  return candidates;
}

function resolveRepositoryModule({
  specifier,
  callerPath,
  root,
  packageJson,
  phase = 'full',
}) {
  if (BUILTINS.has(specifier)) return { external: `builtin:${specifier.replace(/^node:/, '')}` };
  let target;
  if (specifier.startsWith('#')) {
    const mapped = resolveImportMapping(specifier, packageJson);
    if (!mapped) {
      throw new DirectControlGraphError(`unresolved package import ${specifier} from ${callerPath}`);
    }
    target = resolve(root, mapped);
  } else if (specifier.startsWith('.') || specifier.startsWith('/')) {
    target = specifier.startsWith('/')
      ? resolve(specifier)
      : resolve(dirname(callerPath), specifier);
  } else if (specifier.startsWith('file:')) {
    target = fileURLToPath(specifier);
  } else {
    return { external: `package:${packageName(specifier)}` };
  }
  const normalizedTarget = normalizedRelative(root, target, 'resolved module');
  if (phase === 'source' && isGeneratedBuildOutputPath(normalizedTarget)) {
    return { path: normalizedTarget, absolutePath: target };
  }
  for (const candidate of candidatePaths(target)) {
    if (isRegularFile(candidate)) {
      return {
        path: normalizedRelative(root, candidate, 'resolved module'),
        absolutePath: candidate,
      };
    }
  }
  throw new DirectControlGraphError(
    `unresolved repository module ${specifier} from ${normalizedRelative(root, callerPath, 'caller')}`,
  );
}

function literalModuleSpecifier(ts, node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function sourceKind(path) {
  const ts = typeScript();
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (path.endsWith('.json')) return ts.ScriptKind.JSON;
  return ts.ScriptKind.TS;
}

function parseStaticModuleEdges(path) {
  const ts = typeScript();
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    sourceKind(path),
  );
  if (source.parseDiagnostics.length > 0) {
    throw new DirectControlGraphError(`cannot parse module ${path}`);
  }
  const edges = [];
  const authenticatedDynamicCallback = node => {
    if (!ts.isIdentifier(node)) return false;
    let current = node.parent;
    while (current) {
      if (ts.isArrowFunction(current)) {
        return current.parameters.length === 1
          && ts.isIdentifier(current.parameters[0].name)
          && current.parameters[0].name.text === node.text
          && ts.isParameter(current.parent)
          && ts.isIdentifier(current.parent.name)
          && current.parent.name.text === 'importDataUrl';
      }
      current = current.parent;
    }
    return false;
  };
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        && node.moduleSpecifier) {
      const specifier = literalModuleSpecifier(ts, node.moduleSpecifier);
      if (specifier === null) {
        throw new DirectControlGraphError(`nonliteral static module edge in ${path}`);
      }
      if (!ts.isImportDeclaration(node) || !node.importClause?.isTypeOnly) {
        edges.push({ class: 'js-ts-static-import-export', specifier });
      }
    } else if (ts.isImportEqualsDeclaration(node)
        && ts.isExternalModuleReference(node.moduleReference)) {
      const specifier = literalModuleSpecifier(ts, node.moduleReference.expression);
      if (specifier === null) {
        throw new DirectControlGraphError(`nonliteral import-equals edge in ${path}`);
      }
      edges.push({ class: 'js-ts-static-import-export', specifier });
    } else if (ts.isCallExpression(node)
        && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = node.arguments.length === 1
        ? literalModuleSpecifier(ts, node.arguments[0])
        : null;
      if (specifier === null) {
        const argument = node.arguments[0];
        if (path.endsWith(`${sep}generate-built-search-adapter-contract.mjs`)
            && node.arguments.length === 1
            && ts.isTemplateExpression(argument)
            && argument.getText(source).includes('pathToFileURL(runtimePath).href')) {
          edges.push({
            class: 'js-ts-literal-dynamic-import',
            external: 'bounded-generated-contract-runtime',
            specifier: '<generated-contract-runtime>',
          });
          ts.forEachChild(node, visit);
          return;
        }
        if (node.arguments.length === 1
            && ts.isPropertyAccessExpression(argument)
            && argument.name.text === 'href'
            && ts.isCallExpression(argument.expression)
            && ts.isIdentifier(argument.expression.expression)
            && argument.expression.expression.text === 'pathToFileURL'
            && argument.expression.arguments.length === 1
            && ts.isIdentifier(argument.expression.arguments[0])
            && argument.expression.arguments[0].text === 'fullPath') {
          edges.push({
            class: 'js-ts-literal-dynamic-import',
            external: 'user-plugin-module',
            specifier: '<external-plugin-entry>',
          });
          ts.forEachChild(node, visit);
          return;
        }
        if (node.arguments.length === 1
            && ts.isTemplateExpression(argument)
            && argument.head.text === 'file://'
            && argument.templateSpans.length === 1
            && ts.isIdentifier(argument.templateSpans[0].expression)
            && argument.templateSpans[0].expression.text === 'entryFile') {
          edges.push({
            class: 'js-ts-literal-dynamic-import',
            external: 'user-extension-module',
            specifier: '<external-extension-entry>',
          });
          ts.forEachChild(node, visit);
          return;
        }
        if (node.arguments.length === 1
            && (authenticatedDynamicCallback(node.arguments[0])
              || (path.endsWith(`${sep}search-ranking-module-attestation.mjs`)
                && ts.isIdentifier(node.arguments[0])
                && node.arguments[0].text === 'specifier'))) {
          edges.push({
            class: 'js-ts-literal-dynamic-import',
            external: 'authenticated-data-url-module',
            specifier: '<authenticated-data-url>',
          });
          ts.forEachChild(node, visit);
          return;
        }
        throw new DirectControlGraphError(`nonliteral dynamic import in ${path}`);
      }
      edges.push({ class: 'js-ts-literal-dynamic-import', specifier });
    } else if (ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'require') {
      const specifier = node.arguments.length === 1
        ? literalModuleSpecifier(ts, node.arguments[0])
        : null;
      if (specifier === null) {
        throw new DirectControlGraphError(`nonliteral require in ${path}`);
      }
      edges.push({ class: 'js-ts-static-import-export', specifier });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { source, edges };
}

function declarationName(ts, declaration) {
  return ts.isIdentifier(declaration.name) ? declaration.name.text : null;
}

function literalArray(ts, node) {
  if (!node) return null;
  if (ts.isArrayLiteralExpression(node)) {
    const values = node.elements.map(element => {
      if (ts.isStringLiteralLike(element)) return element.text;
      const nested = literalArray(ts, element);
      return nested;
    });
    return values.some(value => value === null) ? null : values;
  }
  if (ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'Object'
      && node.expression.name.text === 'freeze'
      && node.arguments.length === 1) {
    return literalArray(ts, node.arguments[0]);
  }
  return null;
}

function extractLiteralTestPaths(source, sourcePath) {
  const ts = typeScript();
  const paths = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const name = declarationName(ts, declaration);
      if (name === 'ROOT_TEST_PATHS'
          || name === 'DASHBOARD_TEST_PATHS'
          || name === 'PRODUCTION_ARTIFACTS') {
        const values = literalArray(ts, declaration.initializer);
        if (!values || values.some(value => typeof value !== 'string')) {
          throw new DirectControlGraphError(`${name} in ${sourcePath} must be a literal string array`);
        }
        for (const value of values) {
          paths.push({
            name,
            path: name === 'DASHBOARD_TEST_PATHS' ? `dashboard/${value}` : value,
            generated: name === 'PRODUCTION_ARTIFACTS',
          });
        }
      } else if (name?.endsWith('_PATH')
          && ts.isStringLiteralLike(declaration.initializer)) {
        paths.push({ name, path: declaration.initializer.text });
      }
    }
  }
  const visit = node => {
    if (ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && ['readArtifact', 'readCertifiedArtifact'].includes(node.expression.text)
        && node.arguments.length >= 1
        && ts.isStringLiteralLike(node.arguments[0])) {
      paths.push({
        name: `${node.expression.text}-literal`,
        path: node.arguments[0].text,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return paths;
}

function memberName(ts, expression) {
  if (!ts.isPropertyAccessExpression(expression)) return null;
  const left = ts.isIdentifier(expression.expression)
    ? expression.expression.text
    : memberName(ts, expression.expression);
  return left ? `${left}.${expression.name.text}` : null;
}

function executeInlineProgram(program, {
  root,
  owner,
  addGeneratedMapping,
  addExternal,
}) {
  const ts = typeScript();
  const source = ts.createSourceFile(
    `${owner}.inline.cjs`,
    program,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  if (source.parseDiagnostics.length > 0) {
    throw new DirectControlGraphError(`cannot parse inline program owned by ${owner}`);
  }

  const evaluate = (node, environment) => {
    if (!node) return undefined;
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isIdentifier(node)) {
      if (!environment.has(node.text)) {
        throw new DirectControlGraphError(`unresolved inline identifier ${node.text}`);
      }
      return environment.get(node.text);
    }
    if (ts.isArrayLiteralExpression(node)) {
      return node.elements.map(element => evaluate(element, environment));
    }
    if (ts.isObjectLiteralExpression(node)) return {};
    if (ts.isPropertyAccessExpression(node)) {
      const base = evaluate(node.expression, environment);
      return { member: node.name.text, base };
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        if (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0])) {
          throw new DirectControlGraphError('inline require operand must be literal');
        }
        const specifier = node.arguments[0].text;
        if (!BUILTINS.has(specifier)) {
          throw new DirectControlGraphError(`inline require must name a Node builtin: ${specifier}`);
        }
        addExternal(`builtin:${specifier.replace(/^node:/, '')}`, owner);
        return { module: specifier.replace(/^node:/, '') };
      }
      const callee = memberName(ts, node.expression);
      const args = node.arguments.map(argument => evaluate(argument, environment));
      if (callee?.endsWith('.join')) {
        if (args.some(value => typeof value !== 'string')) {
          throw new DirectControlGraphError('inline path.join operands must be bounded strings');
        }
        return join(...args);
      }
      if (callee?.endsWith('.dirname')) {
        if (args.length !== 1 || typeof args[0] !== 'string') {
          throw new DirectControlGraphError('inline path.dirname operand must be a bounded string');
        }
        return dirname(args[0]);
      }
      if (callee?.endsWith('.existsSync')) {
        if (args.length !== 1 || typeof args[0] !== 'string') {
          throw new DirectControlGraphError('inline existsSync operand must be a bounded string');
        }
        return existsSync(resolve(root, args[0]));
      }
      if (callee?.endsWith('.readdirSync')) {
        if (args.length !== 1 || typeof args[0] !== 'string') {
          throw new DirectControlGraphError('inline readdirSync operand must be a bounded string');
        }
        const directory = resolve(root, args[0]);
        return readdirSync(directory, { withFileTypes: true })
          .filter(entry => entry.isFile())
          .map(entry => entry.name)
          .sort();
      }
      if (callee?.endsWith('.mkdirSync')) return undefined;
      if (callee?.endsWith('.copyFileSync')) {
        if (args.length !== 2 || args.some(value => typeof value !== 'string')) {
          throw new DirectControlGraphError('inline copyFileSync operands must be bounded strings');
        }
        addGeneratedMapping(args[0], args[1], owner);
        return undefined;
      }
      throw new DirectControlGraphError(`unsupported inline call ${callee ?? '<dynamic>'}`);
    }
    throw new DirectControlGraphError(`unsupported inline expression kind ${node.kind}`);
  };

  const bind = (name, value, environment) => {
    if (ts.isIdentifier(name)) {
      environment.set(name.text, value);
      return;
    }
    if (ts.isArrayBindingPattern(name)
        && Array.isArray(value)
        && name.elements.length === value.length) {
      name.elements.forEach((element, index) => bind(element.name, value[index], environment));
      return;
    }
    throw new DirectControlGraphError('unsupported inline binding pattern');
  };

  const execute = (statements, environment) => {
    for (const statement of statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          bind(declaration.name, evaluate(declaration.initializer, environment), environment);
        }
      } else if (ts.isExpressionStatement(statement)) {
        evaluate(statement.expression, environment);
      } else if (ts.isIfStatement(statement)) {
        evaluate(statement.expression, environment);
        const branch = ts.isBlock(statement.thenStatement)
          ? statement.thenStatement.statements
          : [statement.thenStatement];
        execute(branch, new Map(environment));
        if (statement.elseStatement) {
          const alternate = ts.isBlock(statement.elseStatement)
            ? statement.elseStatement.statements
            : [statement.elseStatement];
          execute(alternate, new Map(environment));
        }
      } else if (ts.isForOfStatement(statement)) {
        const values = evaluate(statement.expression, environment);
        if (!Array.isArray(values)) {
          throw new DirectControlGraphError('inline for-of operand must be a bounded array');
        }
        const declarations = statement.initializer.declarations;
        if (!ts.isVariableDeclarationList(statement.initializer)
            || declarations.length !== 1) {
          throw new DirectControlGraphError('inline for-of binding must be a single declaration');
        }
        for (const value of values) {
          const nested = new Map(environment);
          bind(declarations[0].name, value, nested);
          execute(
            ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement],
            nested,
          );
        }
      } else if (ts.isBlock(statement)) {
        execute(statement.statements, new Map(environment));
      } else {
        throw new DirectControlGraphError(`unsupported inline statement kind ${statement.kind}`);
      }
    }
  };
  execute(source.statements, new Map());
}

function rustModuleEdges(path) {
  const text = readFileSync(path, 'utf8');
  const results = [];
  const attributed = /#\s*\[\s*path\s*=\s*"([^"]+)"\s*\]\s*(?:pub\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/g;
  const attributedNames = new Set();
  for (const match of text.matchAll(attributed)) {
    attributedNames.add(match[2]);
    results.push(resolve(dirname(path), match[1]));
  }
  const ordinary = /(?:^|\n)\s*(?:pub\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/g;
  for (const match of text.matchAll(ordinary)) {
    if (attributedNames.has(match[1])) continue;
    const sibling = resolve(dirname(path), `${match[1]}.rs`);
    const nested = resolve(dirname(path), match[1], 'mod.rs');
    if (isRegularFile(sibling)) results.push(sibling);
    else if (isRegularFile(nested)) results.push(nested);
    else throw new DirectControlGraphError(`unresolved Rust module ${match[1]} from ${path}`);
  }
  return sortedUnique(results);
}

function topLevelPathConstants(source, root) {
  const ts = typeScript();
  const values = new Map([['repoRoot', root]]);
  const evaluate = node => {
    if (!node) return undefined;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isIdentifier(node)) return values.get(node.text);
    if (ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && ['join', 'resolve'].includes(node.expression.text)) {
      const args = node.arguments.map(evaluate);
      if (args.every(value => typeof value === 'string')) {
        return node.expression.text === 'join' ? join(...args) : resolve(...args);
      }
    }
    return undefined;
  };
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const name = declarationName(ts, declaration);
      if (!name) continue;
      const value = evaluate(declaration.initializer);
      if (typeof value === 'string') values.set(name, value);
    }
  }
  return values;
}

function isWorkspaceRuntimeLog(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  return normalized === '.workflow/spec-analytics.jsonl'
    || (normalized.startsWith('.workflow/') && normalized.endsWith('.jsonl'));
}

function boundedRepositoryFileOperands(source, root) {
  const ts = typeScript();
  const values = topLevelPathConstants(source, root);
  const evaluate = node => {
    if (!node) return undefined;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isIdentifier(node)) return values.get(node.text);
    if (ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && ['join', 'resolve'].includes(node.expression.text)) {
      const args = node.arguments.map(evaluate);
      if (args.every(value => typeof value === 'string')) {
        return node.expression.text === 'join' ? join(...args) : resolve(...args);
      }
    }
    return undefined;
  };
  const paths = new Set();
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const value = evaluate(node);
      if (typeof value === 'string') {
        const absolute = isAbsolute(value) ? value : resolve(root, value);
        if (isRegularFile(absolute)) {
          const relativePath = relative(root, absolute);
          if (!isWorkspaceRuntimeLog(relativePath)) paths.add(absolute);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...paths].sort();
}

function createGraphBuilder({ root, phase }) {
  const paths = new Set();
  const virtualNodes = new Map();
  const edges = [];
  const codeQueue = [];
  const queuedCode = new Set();

  const addVirtual = (id, bytes, owner, kind) => {
    const node = {
      id,
      kind,
      owner,
      sha256: sha256(Buffer.from(bytes)),
      byte_length: Buffer.byteLength(bytes),
    };
    const existing = virtualNodes.get(id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(node)) {
      throw new DirectControlGraphError(`virtual node identity collision: ${id}`);
    }
    virtualNodes.set(id, node);
    return id;
  };

  const addEdge = (edgeClass, from, to, provenance = {}) => {
    if (!EDGE_CLASSES.includes(edgeClass)) {
      throw new DirectControlGraphError(`unknown edge class ${edgeClass}`);
    }
    edges.push({
      class: edgeClass,
      from,
      to,
      provenance: canonical(provenance),
    });
  };

  const addFile = (path, {
    edgeClass,
    from,
    provenance,
    generated = false,
    nativeByte = false,
    queueCode = true,
  }) => {
    const relativePath = normalizedDeclaredPath(path.replaceAll('\\', '/'), 'derived path');
    const effectiveEdgeClass = generated ? 'generated-output-source' : edgeClass;
    const effectiveProvenance = generated
      ? { ...provenance, role: 'output' }
      : provenance;
    if ((generated || nativeByte) && phase === 'source') {
      addEdge(effectiveEdgeClass, from, relativePath, { ...effectiveProvenance, phase: 'full' });
      if (generated) {
        const sourcePath = generatedSourceCounterpart(root, relativePath);
        if (sourcePath) {
          addFile(sourcePath, {
            edgeClass: 'generated-output-source',
            from: relativePath,
            provenance: { role: 'source' },
          });
        }
      }
      return relativePath;
    }
    const absolutePath = resolve(root, relativePath);
    if (!isRegularFile(absolutePath)) {
      throw new DirectControlGraphError(`derived control file is missing: ${relativePath}`);
    }
    paths.add(relativePath);
    addEdge(effectiveEdgeClass, from, relativePath, effectiveProvenance);
    if (generated && phase === 'full') {
      const sourcePath = generatedSourceCounterpart(root, relativePath);
      if (sourcePath) {
        addFile(sourcePath, {
          edgeClass: 'generated-output-source',
          from: relativePath,
          provenance: { role: 'source' },
        });
      }
    }
    if (queueCode && CODE_EXTENSIONS.has(extname(relativePath)) && !queuedCode.has(relativePath)) {
      queuedCode.add(relativePath);
      codeQueue.push(relativePath);
    }
    return relativePath;
  };

  return {
    paths,
    virtualNodes,
    edges,
    codeQueue,
    addVirtual,
    addEdge,
    addFile,
  };
}

export function deriveSearchRankingDirectControlGraph({
  root = repoRoot,
  rootsPath = resolve(root, 'scripts/search-ranking-direct-control-roots.json'),
  phase = 'full',
  packageJson: packageJsonOverride,
} = {}) {
  const absoluteRoot = resolve(root);
  if (!['source', 'full'].includes(phase)) {
    throw new DirectControlGraphError(`unsupported graph phase: ${phase}`);
  }
  const rootsRelative = normalizedRelative(absoluteRoot, rootsPath, 'roots path');
  const rootsBytes = readFileSync(rootsPath);
  const roots = parseDirectControlRoots(rootsBytes);
  const packagePath = resolve(absoluteRoot, 'package.json');
  const packageBytes = readFileSync(packagePath);
  const packageJson = packageJsonOverride ?? JSON.parse(packageBytes.toString('utf8'));
  const lockPath = resolve(absoluteRoot, 'package-lock.json');
  const packageLock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const graph = createGraphBuilder({ root: absoluteRoot, phase });

  graph.addFile(rootsRelative, {
    edgeClass: 'package-script-token',
    from: 'virtual:direct-control-root',
    provenance: { role: 'root-schema' },
    queueCode: false,
  });
  graph.addFile('package.json', {
    edgeClass: 'package-script-token',
    from: 'virtual:direct-control-root',
    provenance: { role: 'package-script-owner' },
    queueCode: false,
  });
  graph.addFile('package-lock.json', {
    edgeClass: 'package-script-token',
    from: 'package.json',
    provenance: { role: 'external-tool-identity' },
    queueCode: false,
  });

  const addExternal = (identity, from) => {
    graph.addEdge('js-ts-static-import-export', from, `external:${identity}`, {
      excluded: true,
    });
  };
  const addGeneratedMapping = (source, output, owner) => {
    const sourcePath = normalizedRelative(
      absoluteRoot,
      resolve(absoluteRoot, source),
      'generated source',
    );
    const outputPath = normalizedRelative(
      absoluteRoot,
      resolve(absoluteRoot, output),
      'generated output',
    );
    graph.addFile(sourcePath, {
      edgeClass: 'generated-output-source',
      from: owner,
      provenance: { role: 'source' },
      queueCode: false,
    });
    graph.addFile(outputPath, {
      edgeClass: 'generated-output-source',
      from: sourcePath,
      provenance: { generator: owner, role: 'output' },
      generated: true,
      queueCode: false,
    });
  };

  const processedScripts = new Set();
  const activeScripts = new Set();
  let inlineIndex = 0;

  const addToolIdentity = (cwd, binary, packageIdentityName, owner) => {
    const cwdPackagePath = join(cwd, 'package.json');
    const cwdLockPath = join(cwd, 'package-lock.json');
    const identityPackagePath = isRegularFile(cwdPackagePath) ? cwdPackagePath : packagePath;
    const identityLockPath = isRegularFile(cwdLockPath) ? cwdLockPath : lockPath;
    const identityPackage = identityPackagePath === packagePath
      ? packageJson
      : JSON.parse(readFileSync(identityPackagePath, 'utf8'));
    const identityLock = identityLockPath === lockPath
      ? packageLock
      : JSON.parse(readFileSync(identityLockPath, 'utf8'));
    const packageIdentity = identityLock.packages?.[`node_modules/${packageIdentityName}`];
    const declaredRange = identityPackage.dependencies?.[packageIdentityName]
      ?? identityPackage.devDependencies?.[packageIdentityName]
      ?? identityPackage.optionalDependencies?.[packageIdentityName];
    if (!packageIdentity?.version
        || !packageIdentity.bin
        || !Object.hasOwn(packageIdentity.bin, binary)
        || typeof declaredRange !== 'string') {
      throw new DirectControlGraphError(
        `bare local binary ${binary} has no manifest/lockfile identity`,
      );
    }
    const manifestRelative = normalizedRelative(
      absoluteRoot,
      identityPackagePath,
      'tool manifest',
    );
    const lockRelative = normalizedRelative(absoluteRoot, identityLockPath, 'tool lock');
    graph.addFile(manifestRelative, {
      edgeClass: 'package-script-token',
      from: owner,
      provenance: {
        command: binary,
        package: packageIdentityName,
        declared_range: declaredRange,
        cwd: relative(absoluteRoot, cwd).replaceAll('\\', '/') || '.',
        role: 'tool-manifest',
      },
      queueCode: false,
    });
    graph.addFile(lockRelative, {
      edgeClass: 'package-script-token',
      from: owner,
      provenance: {
        command: binary,
        package: packageIdentityName,
        version: packageIdentity.version,
        role: 'tool-lock',
      },
      queueCode: false,
    });
    graph.addEdge('package-script-token', owner, `external:node_modules/.bin/${binary}`, {
      excluded: true,
      package: packageIdentityName,
      version: packageIdentity.version,
    });
  };

  const processCommand = (tokensInput, context) => {
    const tokens = [...tokensInput];
    while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[0])) {
      tokens.shift();
    }
    if (tokens.length === 0) {
      throw new DirectControlGraphError(`package script ${context.script} has no command`);
    }
    const command = tokens[0];
    if (command === 'cd') {
      if (tokens.length !== 2
          || tokens[1].length === 0
          || /[*?[\]]/.test(tokens[1])) {
        throw new DirectControlGraphError('cd requires one literal directory');
      }
      const next = resolve(context.cwd, tokens[1]);
      normalizedRelative(absoluteRoot, join(next, '.cwd-sentinel'), 'command cwd');
      if (!existsSync(next) || !statSync(next).isDirectory()) {
        throw new DirectControlGraphError(`package script cd target is missing: ${tokens[1]}`);
      }
      context.cwd = next;
      return;
    }
    if (command === 'npm') {
      const runIndex = tokens.indexOf('run');
      if (runIndex < 0
          || runIndex + 1 >= tokens.length
          || tokens.slice(runIndex + 2).some(token => token !== '--')) {
        throw new DirectControlGraphError('npm command must be a literal npm run target');
      }
      processPackageScript(tokens[runIndex + 1], context.cwd);
      return;
    }
    if (command === 'npx') {
      if (tokens[1] !== 'tsc') {
        throw new DirectControlGraphError(`unsupported npx command: ${tokens[1] ?? '<missing>'}`);
      }
      addToolIdentity(context.cwd, 'tsc', 'typescript', context.owner);
      const projectIndex = tokens.findIndex(token => token === '-p' || token === '--project');
      const config = projectIndex >= 0 ? tokens[projectIndex + 1] : 'tsconfig.json';
      if (!config) throw new DirectControlGraphError('tsc project flag requires a literal path');
      graph.addFile(normalizedRelative(
        absoluteRoot,
        resolve(context.cwd, config),
        'tsconfig',
      ), {
        edgeClass: 'package-script-token',
        from: context.owner,
        provenance: { command: 'npx tsc', cwd: relative(absoluteRoot, context.cwd) || '.' },
        queueCode: false,
      });
      return;
    }
    if (command === 'tsc') {
      addToolIdentity(context.cwd, 'tsc', 'typescript', context.owner);
      const projectIndex = tokens.findIndex(token => token === '-p' || token === '--project');
      const config = projectIndex >= 0 ? tokens[projectIndex + 1] : 'tsconfig.json';
      if (!config) throw new DirectControlGraphError('tsc project flag requires a literal path');
      graph.addFile(normalizedRelative(
        absoluteRoot,
        resolve(context.cwd, config),
        'tsconfig',
      ), {
        edgeClass: 'package-script-token',
        from: context.owner,
        provenance: { command: 'tsc', cwd: relative(absoluteRoot, context.cwd) || '.' },
        queueCode: false,
      });
      return;
    }
    if (command !== 'node') {
      throw new DirectControlGraphError(`unsupported package-script command: ${command}`);
    }
    const evalIndex = tokens.findIndex(token => token === '-e' || token === '--eval');
    if (evalIndex >= 0) {
      if (evalIndex + 2 !== tokens.length) {
        throw new DirectControlGraphError('node -e requires one exact inline program');
      }
      const program = tokens[evalIndex + 1];
      const id = `virtual:package.json#scripts.${context.script}:node-e:${inlineIndex}:${sha256(Buffer.from(program))}`;
      inlineIndex += 1;
      graph.addVirtual(id, program, context.owner, 'node-inline-program');
      graph.addEdge('package-script-token', context.owner, id, {
        command: 'node -e',
        cwd: relative(absoluteRoot, context.cwd) || '.',
      });
      executeInlineProgram(program, {
        root: absoluteRoot,
        owner: id,
        addGeneratedMapping,
        addExternal,
      });
      return;
    }
    const fileToken = tokens.slice(1).find(token => !token.startsWith('-'));
    if (!fileToken) throw new DirectControlGraphError('node command has no literal file operand');
    graph.addFile(normalizedRelative(
      absoluteRoot,
      resolve(context.cwd, fileToken),
      'node file',
    ), {
      edgeClass: 'package-script-token',
      from: context.owner,
      provenance: { command: 'node', cwd: relative(absoluteRoot, context.cwd) || '.' },
      queueCode: context.script.startsWith('check:search-ranking-release-machine')
        || context.script === 'build'
        || context.script === 'native:lifecycle:verify',
    });
  };

  const processPackageScript = (name, initialCwd = absoluteRoot) => {
    if (activeScripts.has(name)) {
      throw new DirectControlGraphError(`npm run cycle detected at ${name}`);
    }
    if (processedScripts.has(name)) return;
    const text = packageJson.scripts?.[name];
    if (typeof text !== 'string') {
      throw new DirectControlGraphError(`missing package script root: ${name}`);
    }
    activeScripts.add(name);
    const owner = `package.json#scripts.${name}`;
    const context = { cwd: initialCwd, owner, script: name };
    for (const segment of parseShellScript(text)) {
      processCommand(segment.tokens, context);
    }
    activeScripts.delete(name);
    processedScripts.add(name);
  };

  for (const name of roots.package_scripts) processPackageScript(name);
  for (const name of roots.package_bins) {
    const target = packageJson.bin?.[name];
    if (typeof target !== 'string') {
      throw new DirectControlGraphError(`missing package bin root: ${name}`);
    }
    graph.addFile(normalizedDeclaredPath(target, `package bin ${name}`), {
      edgeClass: 'package-script-token',
      from: `package.json#bin.${name}`,
      provenance: { command: name },
    });
  }
  for (const entrypoint of roots.entrypoints) {
    graph.addFile(entrypoint, {
      edgeClass: 'package-script-token',
      from: 'virtual:direct-control-root',
      provenance: { role: 'entrypoint' },
    });
  }

  const nativeManifest = graph.addFile(roots.native.manifest, {
    edgeClass: 'native-manifest',
    from: 'virtual:direct-control-root',
    provenance: { role: 'native-manifest' },
    queueCode: false,
  });
  const nativeProvenance = graph.addFile(roots.native.provenance, {
    edgeClass: 'native-manifest',
    from: nativeManifest,
    provenance: { role: 'native-provenance' },
    queueCode: false,
  });
  const manifest = JSON.parse(readFileSync(resolve(absoluteRoot, nativeManifest), 'utf8'));
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 5) {
    throw new DirectControlGraphError('native manifest must contain exactly five artifacts');
  }
  for (const artifact of manifest.artifacts) {
    exactKeys(
      artifact,
      ['target', 'platform', 'arch', 'path', 'sha256', 'protocol'],
      'native artifact',
    );
    graph.addFile(normalizedDeclaredPath(artifact.path, 'native artifact path'), {
      edgeClass: 'native-manifest',
      from: nativeManifest,
      provenance: {
        target: artifact.target,
        sha256: artifact.sha256,
        protocol: artifact.protocol,
      },
      nativeByte: true,
      queueCode: false,
    });
  }
  const provenance = JSON.parse(
    readFileSync(resolve(absoluteRoot, nativeProvenance), 'utf8'),
  );
  for (const [kind, hash] of [
    ['dispatch-receipt', provenance.dispatch_receipt_file_sha256],
    ['aggregate-provenance', provenance.aggregate_provenance_sha256],
  ]) {
    if (!/^[a-f0-9]{64}$/.test(hash ?? '')) {
      throw new DirectControlGraphError(`native ${kind} hash is invalid`);
    }
    const id = `virtual:native-${kind}:${hash}`;
    graph.addVirtual(id, hash, nativeProvenance, `native-${kind}`);
    graph.addEdge('workflow-run-artifact-receipt', nativeProvenance, id, { hash });
  }
  if (!Array.isArray(provenance.artifacts) || provenance.artifacts.length !== 5) {
    throw new DirectControlGraphError('native provenance must contain exactly five receipts');
  }
  for (const receipt of provenance.artifacts) {
    if (typeof receipt.target !== 'string'
        || !/^[a-f0-9]{64}$/.test(receipt.job_receipt_sha256 ?? '')) {
      throw new DirectControlGraphError('native job receipt identity is invalid');
    }
    const id = `virtual:native-job-receipt:${receipt.target}:${receipt.job_receipt_sha256}`;
    graph.addVirtual(id, receipt.job_receipt_sha256, nativeProvenance, 'native-job-receipt');
    graph.addEdge('workflow-run-artifact-receipt', nativeProvenance, id, {
      target: receipt.target,
      binary_sha256: receipt.binary_sha256,
    });
  }

  const cargoManifest = graph.addFile(roots.native.cargo_manifest, {
    edgeClass: 'cargo-target-module-lock',
    from: nativeManifest,
    provenance: { role: 'cargo-manifest' },
    queueCode: false,
  });
  const cargoRoot = dirname(resolve(absoluteRoot, cargoManifest));
  graph.addFile(normalizedRelative(absoluteRoot, join(cargoRoot, 'Cargo.lock'), 'Cargo lock'), {
    edgeClass: 'cargo-target-module-lock',
    from: cargoManifest,
    provenance: { role: 'cargo-lock' },
    queueCode: false,
  });
  const rustQueue = [];
  const rustSeen = new Set();
  const queueRust = (path, from, role) => {
    const relativePath = normalizedRelative(absoluteRoot, path, 'Rust target');
    graph.addFile(relativePath, {
      edgeClass: 'cargo-target-module-lock',
      from,
      provenance: { role },
      queueCode: false,
    });
    if (!rustSeen.has(relativePath)) {
      rustSeen.add(relativePath);
      rustQueue.push(relativePath);
    }
  };
  queueRust(join(cargoRoot, 'src', 'main.rs'), cargoManifest, 'default-binary-target');
  const testsRoot = join(cargoRoot, 'tests');
  if (existsSync(testsRoot)) {
    for (const entry of readdirSync(testsRoot, { withFileTypes: true })
      .filter(item => item.isFile() && item.name.endsWith('.rs'))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      queueRust(join(testsRoot, entry.name), cargoManifest, 'integration-test-target');
    }
  }
  while (rustQueue.length > 0) {
    const caller = rustQueue.shift();
    for (const target of rustModuleEdges(resolve(absoluteRoot, caller))) {
      queueRust(target, caller, 'rust-module');
    }
  }

  const workflowTemplate = graph.addFile(roots.registered_workflow.template, {
    edgeClass: 'workflow-run-artifact-receipt',
    from: nativeProvenance,
    provenance: { role: 'workflow-overlay-template' },
    queueCode: false,
  });
  graph.addFile(roots.registered_workflow.path, {
    edgeClass: 'workflow-run-artifact-receipt',
    from: workflowTemplate,
    provenance: {
      workflow_id: roots.registered_workflow.workflow_id,
      default_blob_sha: roots.registered_workflow.default_blob_sha,
    },
    queueCode: false,
  });
  for (const [kind, value] of [
    ['workflow-id', String(roots.registered_workflow.workflow_id)],
    ['default-workflow-blob', roots.registered_workflow.default_blob_sha],
  ]) {
    const id = `virtual:${kind}:${value}`;
    graph.addVirtual(id, value, workflowTemplate, kind);
    graph.addEdge('workflow-run-artifact-receipt', workflowTemplate, id, { value });
  }

  while (graph.codeQueue.length > 0) {
    const caller = graph.codeQueue.shift();
    const absoluteCaller = resolve(absoluteRoot, caller);
    const callerText = readFileSync(absoluteCaller, 'utf8');
    const generatedBy = callerText.match(
      /Generated by (scripts\/[A-Za-z0-9_./-]+\.mjs)\. Do not edit\./,
    )?.[1];
    if (generatedBy) {
      graph.addFile(generatedBy, {
        edgeClass: 'generated-output-source',
        from: caller,
        provenance: { role: 'generator' },
      });
    }
    const parsed = parseStaticModuleEdges(absoluteCaller);
    for (const edge of parsed.edges) {
      if (edge.external) {
        graph.addEdge(edge.class, caller, `external:${edge.external}`, {
          excluded: true,
          specifier: edge.specifier,
        });
        continue;
      }
      const resolved = resolveRepositoryModule({
        specifier: edge.specifier,
        callerPath: absoluteCaller,
        root: absoluteRoot,
        packageJson,
        phase,
      });
      if (resolved.external) {
        graph.addEdge(edge.class, caller, `external:${resolved.external}`, {
          excluded: true,
          specifier: edge.specifier,
        });
      } else {
        graph.addFile(resolved.path, {
          edgeClass: edge.class,
          from: caller,
          provenance: { specifier: edge.specifier },
          generated: isGeneratedBuildOutputPath(resolved.path),
        });
      }
    }
    const literalTestPaths = extractLiteralTestPaths(parsed.source, caller);
    const generatedLiteralPaths = new Set(literalTestPaths
      .filter(literal => literal.generated || isGeneratedBuildOutputPath(literal.path))
      .map(literal => literal.path));
    for (const literal of literalTestPaths) {
      const absoluteLiteral = resolve(absoluteRoot, literal.path);
      const generated = literal.generated || isGeneratedBuildOutputPath(literal.path);
      if (!isRegularFile(absoluteLiteral)
          && !(phase === 'source' && generated)) {
        if (literal.name.endsWith('_PATH')) continue;
        throw new DirectControlGraphError(`literal control file is missing: ${literal.path}`);
      }
      graph.addFile(normalizedRelative(absoluteRoot, absoluteLiteral, 'literal control path'), {
        edgeClass: 'literal-test-command-array',
        from: caller,
        provenance: { array: literal.name },
        generated,
        queueCode: false,
      });
    }
    for (const operand of boundedRepositoryFileOperands(parsed.source, absoluteRoot)) {
      const operandPath = normalizedRelative(absoluteRoot, operand, 'bounded file operand');
      if (operandPath === caller) continue;
      graph.addFile(operandPath, {
        edgeClass: 'literal-test-command-array',
        from: caller,
        provenance: { array: 'bounded-literal-file-operand' },
        generated: generatedLiteralPaths.has(operandPath)
          || isGeneratedBuildOutputPath(operandPath),
        queueCode: false,
      });
    }
    if (caller === 'scripts/generate-built-search-adapter-contract.mjs') {
      const constants = topLevelPathConstants(parsed.source, absoluteRoot);
      const schema = constants.get('defaultSchemaPath');
      for (const outputName of ['defaultRuntimePath', 'defaultDeclarationPath']) {
        const output = constants.get(outputName);
        if (typeof schema !== 'string' || typeof output !== 'string') {
          throw new DirectControlGraphError('generator default source/output paths are not literal');
        }
        addGeneratedMapping(
          normalizedRelative(absoluteRoot, schema, 'generator schema'),
          normalizedRelative(absoluteRoot, output, 'generator output'),
          caller,
        );
      }
    }
  }

  const edgeKeys = new Set();
  const edges = graph.edges
    .map(edge => canonical(edge))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    .filter(edge => {
      const key = JSON.stringify(edge);
      if (edgeKeys.has(key)) return false;
      edgeKeys.add(key);
      return true;
    });
  const expectedPaths = [...graph.paths].sort();
  const virtualCommandNodes = [...graph.virtualNodes.values()]
    .map(canonical)
    .sort((left, right) => left.id.localeCompare(right.id));
  const exclusions = roots.exclusions
    .map(canonical)
    .sort((left, right) => left.pattern.localeCompare(right.pattern));
  return canonical({
    schema_version: 'search-ranking-direct-control-graph/1.0',
    phase,
    roots: {
      package_scripts: [...roots.package_scripts],
      package_bins: [...roots.package_bins],
      entrypoints: [...roots.entrypoints],
    },
    edge_classes: [...EDGE_CLASSES],
    expected_paths: expectedPaths,
    virtual_command_nodes: virtualCommandNodes,
    edges,
    exclusions,
    derived_count: expectedPaths.length,
  });
}

function main(argv) {
  let phase = 'full';
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--phase' && ['source', 'full'].includes(argv[index + 1])) {
      phase = argv[index + 1];
      index += 1;
    } else {
      throw new DirectControlGraphError(`unknown or incomplete argument: ${argv[index]}`);
    }
  }
  process.stdout.write(`${JSON.stringify(deriveSearchRankingDirectControlGraph({ phase }))}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

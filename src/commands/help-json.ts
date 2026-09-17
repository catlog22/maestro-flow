import { Command, type Option } from 'commander';
import { resolve } from 'node:path';

import { SessionStore } from '../run/store.js';

import { registerArtifactCommand } from './artifact.js';
import { registerExecutionV3RetiredCommand } from './execution-v3-retired.js';
import { registerRunV3Command } from './run-v3.js';
import { registerSessionV3Command } from './session-v3.js';

export interface HelpCatalogOption {
  names: string[];
  required: boolean;
  value_arity: 0 | 1 | -1;
  repeatable: boolean;
  choices: string[];
}

export interface HelpCatalogPositional {
  name: string;
  required: boolean;
  variadic: boolean;
  choices: string[];
}

export interface HelpCatalogCommand {
  command: string;
  description: string;
  mutation_scope: 'read' | 'run' | 'orchestration' | 'artifact' | 'retired';
  cas_target: 'none' | 'run' | 'orchestration' | 'artifact';
  options: string[];
  option_specs: HelpCatalogOption[];
  positionals: HelpCatalogPositional[];
  examples: string[];
  deprecated: boolean;
  replacement: string | null;
}

export interface HelpCatalogValidationError {
  code: 'UNKNOWN_OPTION' | 'MISSING_VALUE' | 'EXCESS_POSITIONAL' | 'MISSING_REQUIRED' | 'UNKNOWN_COMMAND';
  argument: string;
  commandPath: string;
  suggestion?: string;
}

export interface HelpCatalogValidationResult {
  ok: boolean;
  errors: HelpCatalogValidationError[];
}

function optionName(option: Option): string {
  return option.long ?? option.short ?? option.flags;
}

function optionSpec(option: Option): HelpCatalogOption {
  const takesValue = option.required || option.optional || option.variadic;
  return {
    names: [option.short, option.long].filter((name): name is string => Boolean(name)),
    required: option.mandatory,
    value_arity: takesValue ? (option.variadic ? -1 : 1) : 0,
    repeatable: option.variadic,
    choices: option.argChoices ? [...option.argChoices] : [],
  };
}

function positionalSpec(command: Command): HelpCatalogPositional[] {
  return command.registeredArguments.map(argument => ({
    name: argument.name(),
    required: argument.required,
    variadic: argument.variadic,
    choices: argument.argChoices ? [...argument.argChoices] : [],
  }));
}

function editDistance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const above = row[j];
      row[j] = left[i - 1] === right[j - 1]
        ? diagonal
        : Math.min(diagonal + 1, row[j] + 1, row[j - 1] + 1);
      diagonal = above;
    }
  }
  return row[right.length];
}

function closestOption(argument: string, names: readonly string[]): string | undefined {
  const candidate = [...names]
    .map(name => ({ name, distance: editDistance(argument, name) }))
    .filter(item => item.distance <= 2)
    .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name))[0];
  return candidate?.name;
}

export function validateArgvAgainstCatalog(
  catalog: readonly HelpCatalogCommand[],
  argv: readonly string[],
): HelpCatalogValidationResult {
  const matches = catalog.filter(item => {
    const tokens = item.command.split(' ');
    return tokens.every((token, index) => argv[index] === token);
  });
  const command = matches.sort((left, right) => right.command.length - left.command.length)[0];
  if (!command) {
    return {
      ok: false,
      errors: [{ code: 'UNKNOWN_COMMAND', argument: argv.join(' '), commandPath: '' }],
    };
  }
  const commandTokens = command.command.split(' ');
  const errors: HelpCatalogValidationError[] = [];
  const knownOptions = command.option_specs.flatMap(option => option.names);
  const seen = new Set<string>();
  const positionals: string[] = [];
  const remaining = argv.slice(commandTokens.length);
  for (let index = 0; index < remaining.length; index++) {
    const argument = remaining[index];
    if (argument === '--') {
      positionals.push(...remaining.slice(index + 1));
      break;
    }
    if (!argument.startsWith('-') || argument === '-') {
      positionals.push(argument);
      continue;
    }
    const [name] = argument.split('=', 1);
    const spec = command.option_specs.find(option => option.names.includes(name));
    if (!spec) {
      errors.push({
        code: 'UNKNOWN_OPTION', argument: name, commandPath: command.command,
        ...(closestOption(name, knownOptions) ? { suggestion: closestOption(name, knownOptions) } : {}),
      });
      continue;
    }
    seen.add(name);
    if (spec.value_arity !== 0 && !argument.includes('=')) {
      const next = remaining[index + 1];
      if (!next || (next.startsWith('-') && next !== '-')) {
        errors.push({ code: 'MISSING_VALUE', argument: name, commandPath: command.command });
      } else {
        index++;
      }
    }
  }
  const maxPositionals = command.positionals.some(item => item.variadic)
    ? Number.POSITIVE_INFINITY
    : command.positionals.length;
  if (positionals.length > maxPositionals) {
    errors.push({
      code: 'EXCESS_POSITIONAL', argument: positionals[maxPositionals] ?? '', commandPath: command.command,
    });
  }
  for (const option of command.option_specs.filter(item => item.required)) {
    if (!option.names.some(name => seen.has(name))) {
      errors.push({
        code: 'MISSING_REQUIRED', argument: option.names[option.names.length - 1] ?? '', commandPath: command.command,
      });
    }
  }
  return { ok: errors.length === 0, errors };
}

function classify(path: string, options: string[]): Pick<HelpCatalogCommand, 'mutation_scope' | 'cas_target'> {
  if (path === 'artifact republish') return { mutation_scope: 'artifact', cas_target: 'artifact' };
  if (path.startsWith('execution ')) return { mutation_scope: 'retired', cas_target: 'none' };
  if (path === 'session open') return { mutation_scope: 'orchestration', cas_target: 'none' };
  if (path === 'session migrate') return { mutation_scope: 'orchestration', cas_target: 'orchestration' };
  if (!options.includes('--request-id')) return { mutation_scope: 'read', cas_target: 'none' };
  if (options.includes('--expected-run-revision')) return { mutation_scope: 'run', cas_target: 'run' };
  if (options.includes('--expected-orchestration-revision')) {
    return { mutation_scope: 'orchestration', cas_target: 'orchestration' };
  }
  throw new Error(`unclassifiable v3 command: ${path}`);
}

function walk(command: Command, prefix: string[] = []): HelpCatalogCommand[] {
  const path = [...prefix, command.name()].filter(Boolean);
  if (command.commands.length > 0) return command.commands.flatMap(child => walk(child, path));
  if (path.length === 0) return [];
  const commandPath = path.join(' ');
  const options = command.options.map(optionName).sort();
  const classification = classify(commandPath, options);
  const deprecated = commandPath.startsWith('execution ');
  return [{
    command: commandPath,
    description: command.description(),
    ...classification,
    options,
    option_specs: command.options.map(optionSpec),
    positionals: positionalSpec(command),
    examples: [`maestro ${commandPath} --help`],
    deprecated,
    replacement: deprecated ? 'session status / run check' : null,
  }];
}

export function buildV3HelpCatalog(): HelpCatalogCommand[] {
  const root = new Command('');
  root.helpCommand(false);
  root.exitOverride();
  registerArtifactCommand(root);
  registerRunV3Command(root);
  registerSessionV3Command(root);
  registerExecutionV3RetiredCommand(root);
  return root.commands.flatMap(command => walk(command, [])).sort((left, right) => left.command.localeCompare(right.command));
}

export function registerHelpJsonCommand(program: Command): void {
  program
    .command('help')
    .description('Emit the registered v3 command catalog')
    .requiredOption('--json', 'emit help-catalog/1.0 JSON')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((options: { workflowRoot: string }) => {
      const writer = new SessionStore(resolve(options.workflowRoot)).sessionSchemaSelection().writer;
      if (writer !== 'session/3.0') {
        throw new Error('help --json v3 catalog requires the session/3.0 writer');
      }
      process.stdout.write(`${JSON.stringify({
        // Keep schema_version for existing consumers; catalog_version marks
        // the additive option/positional metadata used by preflight clients.
        schema_version: 'help-catalog/1.0',
        catalog_version: '2.0',
        commands: buildV3HelpCatalog(),
      })}\n`);
    });
}

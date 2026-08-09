import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import {
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';

export const EXTERNAL_SURFACE_MANIFEST_SCHEMA_VERSION = 'kg-external-surfaces/1.0' as const;
export const EXTERNAL_SURFACE_MANIFEST_RELATIVE_PATH = '.workflow/kg/external-surfaces.json';
export const EXTERNAL_SURFACE_MAX_ENTRIES = 256;
export const EXTERNAL_SURFACE_MAX_FILE_SIZE = 1024 * 1024;

export interface ExternalSurfaceManifestEntry {
  module: string;
  language: 'objc';
  path: string;
}

export interface ResolvedExternalSurfaceFile extends ExternalSurfaceManifestEntry {
  /** Canonical project-relative spelling from the manifest. */
  configuredPath: string;
  /** Exact real filesystem identity. */
  canonicalPath: string;
  size: number;
  modifiedAt: number;
  mtimeMs: number;
  device: number;
  inode: number;
}

export type ExternalSurfaceValidationErrorCode =
  | 'config-not-regular-file'
  | 'config-outside-project'
  | 'config-too-large'
  | 'config-unreadable'
  | 'duplicate-canonical-file'
  | 'file-not-found'
  | 'file-identity-changed'
  | 'file-not-regular'
  | 'file-outside-project'
  | 'file-read-failed'
  | 'file-too-large'
  | 'invalid-json'
  | 'invalid-module'
  | 'invalid-path'
  | 'invalid-root'
  | 'missing-field'
  | 'too-many-files'
  | 'unknown-field'
  | 'unsafe-path'
  | 'unsupported-extension'
  | 'unsupported-language'
  | 'unsupported-schema-version';

export interface ExternalSurfaceValidationError {
  code: ExternalSurfaceValidationErrorCode;
  message: string;
  entryIndex?: number;
  path?: string;
}

export interface ExternalSurfaceManifestValidationResult {
  schemaVersion: typeof EXTERNAL_SURFACE_MANIFEST_SCHEMA_VERSION;
  configPath: string;
  configured: number;
  resolved: number;
  errors: ExternalSurfaceValidationError[];
  digest: string | null;
  files: ResolvedExternalSurfaceFile[];
}

export interface LoadedExternalSurfaceManifest {
  readonly schemaVersion: typeof EXTERNAL_SURFACE_MANIFEST_SCHEMA_VERSION;
  readonly configPath: string;
  readonly configured: number;
  readonly digest: string | null;
  readonly files: readonly ResolvedExternalSurfaceFile[];
}

const ROOT_FIELDS = ['schema_version', 'files'] as const;
const ENTRY_FIELDS = ['module', 'language', 'path'] as const;
const MODULE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const GLOB_PATTERN = /[!*?\[\]{}]/;
const EXTGLOB_PATTERN = /[@+?!*]\(/;
const WINDOWS_ABSOLUTE_PATTERN = /^(?:[A-Za-z]:[\\/]|[\\/]{2})/;

/** A typed fail-closed error suitable for both extraction and CLI diagnostics. */
export class ExternalSurfaceManifestError extends Error {
  readonly detail: ExternalSurfaceValidationError;

  constructor(detail: ExternalSurfaceValidationError) {
    super(`Invalid external surface manifest: ${detail.message}`);
    this.name = 'ExternalSurfaceManifestError';
    this.detail = detail;
  }
}

/** Aggregate raised by extraction when a configured manifest cannot be trusted. */
export class ExternalSurfaceManifestValidationFailure extends Error {
  readonly validation: ExternalSurfaceManifestValidationResult;

  constructor(validation: ExternalSurfaceManifestValidationResult) {
    super(`Invalid external surface manifest: ${validation.errors.map(error => error.message).join('; ')}`);
    this.name = 'ExternalSurfaceManifestValidationFailure';
    this.validation = validation;
  }
}

export function getExternalSurfaceManifestPath(projectRoot: string): string {
  const canonicalProjectRoot = realpathSync(resolve(projectRoot));
  return join(canonicalProjectRoot, ...EXTERNAL_SURFACE_MANIFEST_RELATIVE_PATH.split('/'));
}

/**
 * Resolve one exact entry without walking its parent or following imports.
 * This is the only filesystem bypass granted to ignored external headers.
 */
export function collectExactFile(
  projectRoot: string,
  value: unknown,
  entryIndex = 0,
): ResolvedExternalSurfaceFile {
  const canonicalProjectRoot = realpathSync(resolve(projectRoot));
  const entry = parseManifestEntry(value, entryIndex);
  const configuredPath = normalizeAndValidateRelativeHeaderPath(entry.path, entryIndex);
  const requestedPath = resolve(canonicalProjectRoot, configuredPath);

  if (!existsSync(requestedPath)) {
    throw manifestError('file-not-found', `files[${entryIndex}].path does not exist`, {
      entryIndex,
      path: configuredPath,
    });
  }

  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(requestedPath);
  } catch {
    throw manifestError('file-not-found', `files[${entryIndex}].path cannot be resolved`, {
      entryIndex,
      path: configuredPath,
    });
  }
  if (!isInside(canonicalProjectRoot, canonicalPath)) {
    throw manifestError('file-outside-project', `files[${entryIndex}].path escapes the project root`, {
      entryIndex,
      path: configuredPath,
    });
  }

  let stat;
  try {
    stat = statSync(canonicalPath);
  } catch {
    throw manifestError('file-not-found', `files[${entryIndex}].path cannot be stated`, {
      entryIndex,
      path: configuredPath,
    });
  }
  if (!stat.isFile()) {
    throw manifestError('file-not-regular', `files[${entryIndex}].path must resolve to a regular file`, {
      entryIndex,
      path: configuredPath,
    });
  }
  if (stat.size > EXTERNAL_SURFACE_MAX_FILE_SIZE) {
    throw manifestError(
      'file-too-large',
      `files[${entryIndex}].path exceeds ${EXTERNAL_SURFACE_MAX_FILE_SIZE} bytes`,
      { entryIndex, path: configuredPath },
    );
  }

  return Object.freeze({
    module: entry.module,
    language: entry.language,
    path: configuredPath,
    configuredPath,
    canonicalPath,
    size: stat.size,
    modifiedAt: Math.floor(stat.mtimeMs),
    mtimeMs: stat.mtimeMs,
    device: stat.dev,
    inode: stat.ino,
  });
}

/**
 * Read a previously collected exact file through a bound descriptor. The
 * identity and size checks close the pathname replacement window without ever
 * opening a directory, import target, or sibling.
 */
export function readExactFile(file: ResolvedExternalSurfaceFile): string {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(file.canonicalPath, safeReadFlags());
    assertExactFileIdentity(file, fstatSync(descriptor));
    const source = readBoundedUtf8File(
      descriptor,
      file.size,
      'file-identity-changed',
      'exact file grew after manifest validation',
      file.configuredPath,
    );
    assertExactFileIdentity(file, fstatSync(descriptor));
    return source;
  } catch (error) {
    if (error instanceof ExternalSurfaceManifestError) throw error;
    throw manifestError('file-read-failed', 'exact file could not be read safely', {
      path: file.configuredPath,
    });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/** Revalidates the collected descriptor identity without rereading content. */
export function verifyExactFileIdentity(file: ResolvedExternalSurfaceFile): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(file.canonicalPath, safeReadFlags());
    assertExactFileIdentity(file, fstatSync(descriptor));
  } catch (error) {
    if (error instanceof ExternalSurfaceManifestError) throw error;
    throw manifestError('file-identity-changed', 'exact file identity changed after preflight', {
      path: file.configuredPath,
    });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/** Resolve an exact allowlist and reject canonical aliases of the same file. */
export function collectExactFiles(
  projectRoot: string,
  values: readonly unknown[],
): ResolvedExternalSurfaceFile[] {
  if (values.length > EXTERNAL_SURFACE_MAX_ENTRIES) {
    throw manifestError(
      'too-many-files',
      `files must contain at most ${EXTERNAL_SURFACE_MAX_ENTRIES} entries`,
    );
  }

  const resolvedFiles: ResolvedExternalSurfaceFile[] = [];
  const entryByCanonicalPath = new Map<string, number>();
  for (let index = 0; index < values.length; index++) {
    const file = collectExactFile(projectRoot, values[index], index);
    const priorIndex = entryByCanonicalPath.get(file.canonicalPath);
    if (priorIndex !== undefined) {
      throw manifestError(
        'duplicate-canonical-file',
        `files[${index}].path resolves to the same file as files[${priorIndex}].path`,
        { entryIndex: index, path: file.configuredPath },
      );
    }
    entryByCanonicalPath.set(file.canonicalPath, index);
    resolvedFiles.push(file);
  }
  return resolvedFiles;
}

/**
 * Validate the one fixed project carrier. Missing is intentionally equivalent
 * to an empty allowlist; every configured failure is returned as a typed error.
 */
export function validateExternalSurfaceManifest(
  projectRoot: string,
): ExternalSurfaceManifestValidationResult {
  const canonicalProjectRoot = realpathSync(resolve(projectRoot));
  const requestedConfigPath = join(
    canonicalProjectRoot,
    ...EXTERNAL_SURFACE_MANIFEST_RELATIVE_PATH.split('/'),
  );
  const empty = (
    configPath: string,
    overrides: Partial<ExternalSurfaceManifestValidationResult> = {},
  ): ExternalSurfaceManifestValidationResult => ({
    schemaVersion: EXTERNAL_SURFACE_MANIFEST_SCHEMA_VERSION,
    configPath,
    configured: 0,
    resolved: 0,
    errors: [],
    digest: null,
    files: [],
    ...overrides,
  });

  try {
    lstatSync(requestedConfigPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty(requestedConfigPath);
    return empty(requestedConfigPath, {
      errors: [validationError('config-unreadable', 'manifest path cannot be inspected')],
    });
  }

  let configPath: string;
  try {
    configPath = realpathSync(requestedConfigPath);
  } catch {
    return empty(requestedConfigPath, {
      errors: [validationError('config-unreadable', 'manifest path cannot be resolved')],
    });
  }
  if (!isInside(canonicalProjectRoot, configPath)) {
    return empty(configPath, {
      errors: [validationError('config-outside-project', 'manifest path escapes the project root')],
    });
  }

  let configStat;
  try {
    configStat = statSync(configPath);
  } catch {
    return empty(configPath, {
      errors: [validationError('config-unreadable', 'manifest path cannot be stated')],
    });
  }
  if (!configStat.isFile()) {
    return empty(configPath, {
      errors: [validationError('config-not-regular-file', 'manifest must be a regular file')],
    });
  }
  if (configStat.size > EXTERNAL_SURFACE_MAX_FILE_SIZE) {
    return empty(configPath, {
      errors: [validationError(
        'config-too-large',
        `manifest exceeds ${EXTERNAL_SURFACE_MAX_FILE_SIZE} bytes`,
      )],
    });
  }

  let raw: string;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(configPath, safeReadFlags());
    const before = fstatSync(descriptor);
    if (
      !before.isFile()
      || before.dev !== configStat.dev
      || before.ino !== configStat.ino
      || before.size !== configStat.size
      || before.mtimeMs !== configStat.mtimeMs
    ) {
      return empty(configPath, {
        errors: [validationError('config-unreadable', 'manifest identity changed during validation')],
      });
    }
    raw = readBoundedUtf8File(
      descriptor,
      configStat.size,
      'config-unreadable',
      'manifest grew while being read',
    );
    const after = fstatSync(descriptor);
    if (
      !after.isFile()
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
    ) {
      return empty(configPath, {
        errors: [validationError('config-unreadable', 'manifest changed while being read')],
      });
    }
  } catch (error) {
    return empty(configPath, {
      errors: [error instanceof ExternalSurfaceManifestError
        ? error.detail
        : validationError('config-unreadable', 'manifest cannot be read')],
    });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  const digest = createHash('sha256').update(raw).digest('hex');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty(configPath, {
      digest,
      errors: [validationError('invalid-json', 'manifest is not valid JSON')],
    });
  }

  let values: unknown[];
  try {
    values = parseManifestRoot(parsed);
  } catch (error) {
    return empty(configPath, {
      digest,
      configured: configuredCount(parsed),
      errors: [toValidationError(error)],
    });
  }

  try {
    const files = collectExactFiles(canonicalProjectRoot, values);
    return empty(configPath, {
      configured: values.length,
      resolved: files.length,
      digest,
      files,
    });
  } catch (error) {
    return empty(configPath, {
      configured: values.length,
      digest,
      errors: [toValidationError(error)],
    });
  }
}

/** Strict extraction loader: any configured error aborts the caller. */
export function loadExternalSurfaceManifest(projectRoot: string): LoadedExternalSurfaceManifest {
  const validation = validateExternalSurfaceManifest(projectRoot);
  if (validation.errors.length > 0) {
    throw new ExternalSurfaceManifestValidationFailure(validation);
  }
  return Object.freeze({
    schemaVersion: validation.schemaVersion,
    configPath: validation.configPath,
    configured: validation.configured,
    digest: validation.digest,
    files: Object.freeze([...validation.files]),
  });
}

function parseManifestRoot(value: unknown): unknown[] {
  const root = requireRecord(value, 'root');
  assertExactFields(root, ROOT_FIELDS, 'root');
  if (root.schema_version !== EXTERNAL_SURFACE_MANIFEST_SCHEMA_VERSION) {
    throw manifestError(
      'unsupported-schema-version',
      `schema_version must be ${EXTERNAL_SURFACE_MANIFEST_SCHEMA_VERSION}`,
    );
  }
  if (!Array.isArray(root.files)) {
    throw manifestError('invalid-root', 'root.files must be an array');
  }
  if (root.files.length > EXTERNAL_SURFACE_MAX_ENTRIES) {
    throw manifestError(
      'too-many-files',
      `files must contain at most ${EXTERNAL_SURFACE_MAX_ENTRIES} entries`,
    );
  }
  return root.files;
}

function parseManifestEntry(value: unknown, entryIndex: number): ExternalSurfaceManifestEntry {
  const context = `files[${entryIndex}]`;
  const entry = requireRecord(value, context);
  assertExactFields(entry, ENTRY_FIELDS, context, entryIndex);
  if (typeof entry.module !== 'string' || !MODULE_PATTERN.test(entry.module)) {
    throw manifestError('invalid-module', `${context}.module must be an identifier`, { entryIndex });
  }
  if (entry.language !== 'objc') {
    throw manifestError('unsupported-language', `${context}.language must be objc`, { entryIndex });
  }
  if (typeof entry.path !== 'string') {
    throw manifestError('invalid-path', `${context}.path must be a string`, { entryIndex });
  }
  return {
    module: entry.module,
    language: entry.language,
    path: entry.path,
  };
}

function normalizeAndValidateRelativeHeaderPath(value: string, entryIndex: number): string {
  const context = `files[${entryIndex}].path`;
  if (value.length === 0 || value.includes('\0')) {
    throw manifestError('invalid-path', `${context} must be non-empty and contain no NUL`, {
      entryIndex,
      path: value,
    });
  }
  if (value.endsWith('/') || value.endsWith('\\')) {
    throw manifestError('unsafe-path', `${context} must name a file, not a directory`, {
      entryIndex,
      path: value,
    });
  }
  if (isAbsolute(value) || WINDOWS_ABSOLUTE_PATTERN.test(value)) {
    throw manifestError('unsafe-path', `${context} must be project-relative`, {
      entryIndex,
      path: value,
    });
  }
  const normalized = value.replace(/\\/g, '/');
  if (normalized.split('/').some(segment => segment === '..')) {
    throw manifestError('unsafe-path', `${context} must not contain a .. segment`, {
      entryIndex,
      path: value,
    });
  }
  if (GLOB_PATTERN.test(normalized)) {
    throw manifestError('unsafe-path', `${context} must not contain glob characters`, {
      entryIndex,
      path: value,
    });
  }
  if (EXTGLOB_PATTERN.test(normalized)) {
    throw manifestError('unsafe-path', `${context} must not contain extglob syntax`, {
      entryIndex,
      path: value,
    });
  }
  if (extname(normalized).toLowerCase() !== '.h') {
    throw manifestError('unsupported-extension', `${context} must name a .h file`, {
      entryIndex,
      path: value,
    });
  }
  return normalized;
}

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw manifestError('invalid-root', `${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactFields(
  value: Record<string, unknown>,
  expected: readonly string[],
  context: string,
  entryIndex?: number,
): void {
  const expectedSet = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!expectedSet.has(key)) {
      throw manifestError('unknown-field', `unknown field ${context}.${key}`, { entryIndex });
    }
  }
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw manifestError('missing-field', `missing field ${context}.${key}`, { entryIndex });
    }
  }
}

function configuredCount(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const files = (value as Record<string, unknown>).files;
  return Array.isArray(files) ? files.length : 0;
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!/^\.\.(?:[\\/]|$)/.test(rel) && !isAbsolute(rel));
}

function safeReadFlags(): number {
  return constants.O_RDONLY
    | (constants.O_NOFOLLOW ?? 0)
    | (constants.O_NONBLOCK ?? 0);
}

function readBoundedUtf8File(
  descriptor: number,
  maxBytes: number,
  overflowCode: ExternalSurfaceValidationErrorCode,
  overflowMessage: string,
  path?: string,
): string {
  const buffer = Buffer.allocUnsafe(maxBytes + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const bytesRead = readSync(descriptor, buffer, offset, buffer.length - offset, null);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset > maxBytes) {
    throw manifestError(overflowCode, overflowMessage, { path });
  }
  return buffer.subarray(0, offset).toString('utf-8');
}

function assertExactFileIdentity(
  file: ResolvedExternalSurfaceFile,
  stat: ReturnType<typeof fstatSync>,
): void {
  if (!stat.isFile()) {
    throw manifestError('file-not-regular', 'exact file is no longer a regular file', {
      path: file.configuredPath,
    });
  }
  if (stat.size > EXTERNAL_SURFACE_MAX_FILE_SIZE) {
    throw manifestError('file-too-large', `exact file exceeds ${EXTERNAL_SURFACE_MAX_FILE_SIZE} bytes`, {
      path: file.configuredPath,
    });
  }
  if (
    stat.dev !== file.device
    || stat.ino !== file.inode
    || stat.size !== file.size
    || stat.mtimeMs !== file.mtimeMs
  ) {
    throw manifestError('file-identity-changed', 'exact file changed after manifest validation', {
      path: file.configuredPath,
    });
  }
}

function validationError(
  code: ExternalSurfaceValidationErrorCode,
  message: string,
  context: Pick<ExternalSurfaceValidationError, 'entryIndex' | 'path'> = {},
): ExternalSurfaceValidationError {
  return {
    code,
    message,
    ...(context.entryIndex === undefined ? {} : { entryIndex: context.entryIndex }),
    ...(context.path === undefined ? {} : { path: context.path }),
  };
}

function manifestError(
  code: ExternalSurfaceValidationErrorCode,
  message: string,
  context: Pick<ExternalSurfaceValidationError, 'entryIndex' | 'path'> = {},
): ExternalSurfaceManifestError {
  return new ExternalSurfaceManifestError(validationError(code, message, context));
}

function toValidationError(error: unknown): ExternalSurfaceValidationError {
  if (error instanceof ExternalSurfaceManifestError) return error.detail;
  return validationError('config-unreadable', error instanceof Error ? error.message : String(error));
}

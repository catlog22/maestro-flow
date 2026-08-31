import { spawn as spawnChild } from 'node:child_process';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import {
  closeSync,
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  writeSync,
} from 'node:fs';
import * as nodeModule from 'node:module';
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { builtinModules } = nodeModule;

export const ATTESTATION_MANIFEST_TYPE = 'attestation-manifest/1';
export const ATTESTATION_TRANSCRIPT_TYPE = 'attestation-transcript/1';
export const ATTESTATION_ENV_ALLOWLIST = Object.freeze([
  'PATH',
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'LANG',
  'LC_ALL',
  'TZ',
  'MAESTRO_PROJECT_ROOT',
]);
export const ATTESTATION_STDIO = Object.freeze([
  'ignore',
  'pipe',
  'pipe',
  'pipe',
  'pipe',
  'pipe',
]);
export const ATTESTATION_NODE_RANGE = '>=22.19.0 <23.0.0';

const ATTESTATION_FRAME_MAX_BYTES = 64 * 1024 * 1024;
const ATTESTATION_KEY_BYTES = 32;
const ATTESTATION_NONCE_BYTES = 32;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MANIFEST_KEYS = Object.freeze([
  'type',
  'nonce',
  'probeId',
  'schemaSha256',
  'sourceHashes',
  'expectedUrls',
]);
const TRANSCRIPT_KEYS = Object.freeze([
  'type',
  'nonce',
  'probeId',
  'rawEvidence',
  'observedUrls',
  'sourceHashes',
  'hmacSha256',
]);

let typeScript;

const BOOTSTRAP_START = Buffer.from(
  ['attestation', '-bootstrap-source-start\n'].join(''),
  'utf8',
);
const BOOTSTRAP_END = Buffer.from(
  ['\nattestation', '-bootstrap-source-end */'].join(''),
  'utf8',
);

/*
attestation-bootstrap-source-start
import { createHash, createHmac } from 'node:crypto';
import { closeSync, readFileSync, writeSync } from 'node:fs';
import { registerHooks } from 'node:module';

const MAX = 64 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/;

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('NONCANONICAL_JSON: non-finite number');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('NONCANONICAL_JSON: non-JSON object');
  }
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(canonical(value)), 'utf8');
}

function decodeFrame(frame) {
  if (frame.length < 4) throw new Error('TRUNCATED_ATTESTATION_FRAME: missing header');
  const length = frame.readUInt32BE(0);
  if (length > MAX) throw new Error('ATTESTATION_FRAME_TOO_LARGE');
  if (frame.length !== length + 4) {
    throw new Error(frame.length < length + 4
      ? 'TRUNCATED_ATTESTATION_FRAME'
      : 'TRAILING_ATTESTATION_BYTES');
  }
  const body = frame.subarray(4);
  const value = JSON.parse(body.toString('utf8'));
  if (!body.equals(canonicalBytes(value))) throw new Error('NONCANONICAL_ATTESTATION_JSON');
  return value;
}

function encodeFrame(value) {
  const body = canonicalBytes(value);
  if (body.length > MAX) throw new Error('ATTESTATION_FRAME_TOO_LARGE');
  const frame = Buffer.allocUnsafe(body.length + 4);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

function readPipe(fd) {
  try {
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeAll(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    offset += writeSync(fd, buffer, offset, buffer.length - offset);
  }
}

function normalizedSource(source) {
  if (typeof source === 'string') return Buffer.from(source, 'utf8');
  if (Buffer.isBuffer(source)) return Buffer.from(source);
  if (source instanceof ArrayBuffer) return Buffer.from(source);
  if (ArrayBuffer.isView(source)) {
    return Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  }
  throw new Error('ATTESTATION_SOURCE_UNAVAILABLE');
}

function exactKeys(value, keys) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

const dataPrefix = 'data:text/javascript;base64,';
if (!import.meta.url.startsWith(dataPrefix)) throw new Error('UNCERTIFIED_ATTESTATION_BOOTSTRAP');
const encodedBootstrap = import.meta.url.slice(dataPrefix.length);
const bootstrap = Buffer.from(encodedBootstrap, 'base64');
if (bootstrap.toString('base64') !== encodedBootstrap) {
  throw new Error('UNCERTIFIED_ATTESTATION_BOOTSTRAP: noncanonical base64');
}
if (process.versions.node.split('.')[0] !== '22'
    || Number(process.versions.node.split('.')[1]) < 19
    || typeof registerHooks !== 'function') {
  throw new Error('UNSUPPORTED_ATTESTATION_RUNTIME');
}
const allowedEnvironment = new Set([
  'path',
  'systemroot',
  'windir',
  'temp',
  'tmp',
  'home',
  'userprofile',
  'lang',
  'lc_all',
  'tz',
  'maestro_project_root',
]);
for (const name of Object.keys(process.env)) {
  if (!allowedEnvironment.has(name.toLowerCase())) delete process.env[name];
}

const key = readPipe(3);
if (key.length !== 32) throw new Error(`INVALID_ATTESTATION_KEY: exactly 32 bytes required; got ${key.length}`);
const manifest = decodeFrame(readPipe(4));
const manifestKeys = ['type', 'nonce', 'probeId', 'schemaSha256', 'sourceHashes', 'expectedUrls'];
if (!exactKeys(manifest, manifestKeys)
    || manifest.type !== 'attestation-manifest/1'
    || !SHA.test(manifest.nonce)
    || typeof manifest.probeId !== 'string'
    || manifest.probeId.length === 0
    || !SHA.test(manifest.schemaSha256)
    || !Array.isArray(manifest.expectedUrls)
    || JSON.stringify([...manifest.expectedUrls].sort()) !== JSON.stringify(manifest.expectedUrls)
    || new Set(manifest.expectedUrls).size !== manifest.expectedUrls.length
    || !exactKeys(manifest.sourceHashes, ['bootstrapSha256', 'modules'])
    || !SHA.test(manifest.sourceHashes.bootstrapSha256)
    || !manifest.sourceHashes.modules
    || typeof manifest.sourceHashes.modules !== 'object'
    || JSON.stringify(Object.keys(manifest.sourceHashes.modules).sort())
      !== JSON.stringify(manifest.expectedUrls)) {
  throw new Error('INVALID_ATTESTATION_MANIFEST');
}
const bootstrapSha256 = createHash('sha256').update(bootstrap).digest('hex');
if (bootstrapSha256 !== manifest.sourceHashes.bootstrapSha256) {
  throw new Error('ATTESTATION_BOOTSTRAP_HASH_MISMATCH');
}

const observed = new Map();
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const output = nextLoad(url, context);
    if (!url.startsWith('file:')) return output;
    const expected = manifest.sourceHashes.modules[url];
    if (expected === undefined) throw new Error(`UNDECLARED_ATTESTATION_LOAD: ${url}`);
    const actual = createHash('sha256').update(normalizedSource(output.source)).digest('hex');
    if (actual !== expected) throw new Error(`ATTESTATION_SOURCE_HASH_MISMATCH: ${url}`);
    observed.set(url, actual);
    return output;
  },
});

const stdoutChunks = [];
const stdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, encoding, callback) => {
  stdoutChunks.push(Buffer.isBuffer(chunk)
    ? Buffer.from(chunk)
    : Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined));
  return stdoutWrite(chunk, encoding, callback);
};

let finalized = false;
process.once('beforeExit', () => {
  if (finalized) return;
  finalized = true;
  try {
    const raw = Buffer.concat(stdoutChunks).toString('utf8').trim();
    if (!raw) throw new Error('MISSING_ATTESTATION_EVIDENCE');
    const rawEvidence = JSON.parse(raw);
    const observedUrls = [...observed.keys()].sort();
    const modules = Object.fromEntries(
      [...observed.entries()].sort(([left], [right]) => left.localeCompare(right)),
    );
    const unsigned = {
      type: 'attestation-transcript/1',
      nonce: manifest.nonce,
      probeId: manifest.probeId,
      rawEvidence,
      observedUrls,
      sourceHashes: { bootstrapSha256, modules },
    };
    const hmacSha256 = createHmac('sha256', key)
      .update(canonicalBytes({ manifest, transcript: unsigned }))
      .digest('hex');
    writeAll(5, encodeFrame({ ...unsigned, hmacSha256 }));
    closeSync(5);
    if (JSON.stringify(observedUrls) !== JSON.stringify(manifest.expectedUrls)) {
      process.exitCode = 1;
    }
  } catch (error) {
    try {
      closeSync(5);
    } catch {
      process.exitCode = 1;
    }
    writeSync(2, Buffer.from(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`));
    process.exitCode = 1;
  }
});
attestation-bootstrap-source-end */

export function extractCertifiedBootstrapBuffer(moduleBuffer) {
  if (!Buffer.isBuffer(moduleBuffer)) {
    fail(
      'UNCERTIFIED_ATTESTATION_BOOTSTRAP',
      'bootstrap extraction requires the retained certified module Buffer',
    );
  }
  const start = moduleBuffer.indexOf(BOOTSTRAP_START);
  const end = moduleBuffer.indexOf(BOOTSTRAP_END);
  if (start < 0
      || end < 0
      || end <= start
      || moduleBuffer.indexOf(BOOTSTRAP_START, start + 1) >= 0
      || moduleBuffer.indexOf(BOOTSTRAP_END, end + 1) >= 0) {
    fail('UNCERTIFIED_ATTESTATION_BOOTSTRAP', 'certified bootstrap byte boundaries are invalid');
  }
  return Buffer.from(moduleBuffer.subarray(start + BOOTSTRAP_START.length, end));
}

export const DYNAMIC_EDGE_MANIFEST_SCHEMA =
  'search-ranking-probe-dynamic-edges/1.0';

export const READ_ONLY_FORBIDDEN_GUARDS = Object.freeze([
  'daemon-start',
  'embedding-build',
  'embedding-admin',
]);

const ROW_KEYS = Object.freeze([
  'probe_id',
  'caller',
  'specifier',
  'resolved_url',
  'guard',
]);

const BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map(name => `node:${name}`),
]);

export class ModuleAttestationError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ModuleAttestationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ModuleAttestationError(code, message, details);
}

function exactKeys(value, keys) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function canonicalValue(value, path = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('NONCANONICAL_JSON', 'canonical JSON rejects non-finite numbers', { path });
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalValue(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object'
      || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('NONCANONICAL_JSON', 'canonical JSON accepts only JSON objects and arrays', {
      path,
    });
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const nested = value[key];
    if (nested === undefined
        || typeof nested === 'function'
        || typeof nested === 'symbol'
        || typeof nested === 'bigint') {
      fail('NONCANONICAL_JSON', 'canonical JSON rejects non-JSON values', {
        path: `${path}.${key}`,
      });
    }
    result[key] = canonicalValue(nested, `${path}.${key}`);
  }
  return result;
}

export function canonicalJsonBuffer(value) {
  return Buffer.from(JSON.stringify(canonicalValue(value)), 'utf8');
}

export function encodeAttestationFrame(value) {
  const body = canonicalJsonBuffer(value);
  if (body.length > ATTESTATION_FRAME_MAX_BYTES) {
    fail('ATTESTATION_FRAME_TOO_LARGE', 'attestation frame exceeds the fixed byte limit', {
      length: body.length,
      maximum: ATTESTATION_FRAME_MAX_BYTES,
    });
  }
  const frame = Buffer.allocUnsafe(4 + body.length);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

export function decodeAttestationFrame(frame) {
  if (!Buffer.isBuffer(frame)) {
    fail('INVALID_ATTESTATION_FRAME', 'attestation frame must be a Buffer');
  }
  if (frame.length < 4) {
    fail('TRUNCATED_ATTESTATION_FRAME', 'attestation frame is missing its uint32 header', {
      length: frame.length,
    });
  }
  const length = frame.readUInt32BE(0);
  if (length > ATTESTATION_FRAME_MAX_BYTES) {
    fail('ATTESTATION_FRAME_TOO_LARGE', 'attestation frame declares an excessive byte length', {
      length,
      maximum: ATTESTATION_FRAME_MAX_BYTES,
    });
  }
  if (frame.length !== 4 + length) {
    fail(
      frame.length < 4 + length
        ? 'TRUNCATED_ATTESTATION_FRAME'
        : 'TRAILING_ATTESTATION_BYTES',
      'attestation channel requires exactly one frame followed by EOF',
      {
        declared: length,
        actual: frame.length - 4,
      },
    );
  }
  const body = frame.subarray(4);
  let value;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch (error) {
    fail('INVALID_ATTESTATION_JSON', 'attestation frame is not valid UTF-8 JSON', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!body.equals(canonicalJsonBuffer(value))) {
    fail('NONCANONICAL_ATTESTATION_JSON', 'attestation frame JSON is not canonical');
  }
  return value;
}

function supportedNodeVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(version);
  if (!match) return false;
  const [, major, minor] = match.map(Number);
  return major === 22 && minor >= 19;
}

export async function assertCertifiedAttestationRuntime({
  nodeVersion = process.versions.node,
  moduleApi = nodeModule,
  importDataUrl = specifier => import(specifier),
} = {}) {
  if (!supportedNodeVersion(nodeVersion)) {
    fail(
      'UNSUPPORTED_ATTESTATION_RUNTIME',
      `attestation requires Node ${ATTESTATION_NODE_RANGE}`,
      { actual: nodeVersion },
    );
  }
  if (typeof moduleApi?.registerHooks !== 'function') {
    fail(
      'REGISTER_HOOKS_UNAVAILABLE',
      'synchronous node:module registerHooks is required; no fallback is permitted',
    );
  }
  const marker = randomBytes(16).toString('hex');
  const source = `export default ${JSON.stringify(marker)}`;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  let loaded;
  try {
    loaded = await importDataUrl(url);
  } catch (error) {
    fail('CERTIFIED_DATA_URL_UNAVAILABLE', 'Node cannot import the certified data URL form', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (loaded?.default !== marker) {
    fail('CERTIFIED_DATA_URL_UNAVAILABLE', 'Node data URL import returned unexpected bytes');
  }
  return {
    nodeVersion,
    range: ATTESTATION_NODE_RANGE,
    registerHooks: true,
    dataUrl: true,
  };
}

export function sanitizeAttestationEnvironment(
  parentEnvironment,
  { projectRoot } = {},
) {
  if (!parentEnvironment || typeof parentEnvironment !== 'object') {
    fail('INVALID_ATTESTATION_ENVIRONMENT', 'parent environment must be an object');
  }
  if (typeof projectRoot !== 'string' || !isAbsolute(projectRoot)) {
    fail('INVALID_ATTESTATION_ENVIRONMENT', 'MAESTRO_PROJECT_ROOT must be absolute', {
      projectRoot,
    });
  }
  const environment = {};
  const valuesByLowerName = new Map(
    Object.entries(parentEnvironment)
      .filter(([, value]) => typeof value === 'string')
      .map(([name, value]) => [name.toLowerCase(), value]),
  );
  for (const name of ATTESTATION_ENV_ALLOWLIST) {
    if (name === 'MAESTRO_PROJECT_ROOT') continue;
    const value = valuesByLowerName.get(name.toLowerCase());
    if (typeof value === 'string') environment[name] = value;
  }
  environment.MAESTRO_PROJECT_ROOT = projectRoot;
  return environment;
}

function validateSourceHashes(sourceHashes, expectedUrls) {
  if (!exactKeys(sourceHashes, ['bootstrapSha256', 'modules'])
      || !SHA256_PATTERN.test(sourceHashes.bootstrapSha256)
      || !sourceHashes.modules
      || typeof sourceHashes.modules !== 'object'
      || Array.isArray(sourceHashes.modules)
      || Object.getPrototypeOf(sourceHashes.modules) !== Object.prototype) {
    fail('INVALID_ATTESTATION_SOURCE_HASHES', 'source hashes require bootstrapSha256 and modules');
  }
  const moduleUrls = Object.keys(sourceHashes.modules).sort();
  if (JSON.stringify(moduleUrls) !== JSON.stringify(expectedUrls)) {
    fail('INVALID_ATTESTATION_SOURCE_HASHES', 'module hash keys must equal expected URLs', {
      expected: expectedUrls,
      actual: moduleUrls,
    });
  }
  for (const [url, hash] of Object.entries(sourceHashes.modules)) {
    if (!url.startsWith('file:') || !SHA256_PATTERN.test(hash)) {
      fail('INVALID_ATTESTATION_SOURCE_HASHES', 'module source hashes require file URLs and SHA-256', {
        url,
        hash,
      });
    }
  }
}

export function validateAttestationManifest(manifest) {
  if (!exactKeys(manifest, MANIFEST_KEYS)
      || manifest.type !== ATTESTATION_MANIFEST_TYPE
      || !SHA256_PATTERN.test(manifest.nonce)
      || typeof manifest.probeId !== 'string'
      || manifest.probeId.length === 0
      || !SHA256_PATTERN.test(manifest.schemaSha256)
      || !Array.isArray(manifest.expectedUrls)
      || manifest.expectedUrls.some(url => typeof url !== 'string' || !url.startsWith('file:'))) {
    fail('INVALID_ATTESTATION_MANIFEST', 'attestation manifest fields are invalid');
  }
  const expectedUrls = [...manifest.expectedUrls].sort();
  if (new Set(expectedUrls).size !== expectedUrls.length
      || JSON.stringify(expectedUrls) !== JSON.stringify(manifest.expectedUrls)) {
    fail('INVALID_ATTESTATION_MANIFEST', 'expected URLs must be sorted and unique');
  }
  validateSourceHashes(manifest.sourceHashes, expectedUrls);
  return manifest;
}

export function createAttestationManifest({
  probeId,
  schemaSha256,
  bootstrapBuffer,
  moduleSourceHashes,
  nonce = randomBytes(ATTESTATION_NONCE_BYTES),
} = {}) {
  if (!Buffer.isBuffer(bootstrapBuffer)) {
    fail(
      'UNCERTIFIED_ATTESTATION_BOOTSTRAP',
      'attestation bootstrap must be the retained certified Buffer; paths are forbidden',
    );
  }
  if (!Buffer.isBuffer(nonce) || nonce.length !== ATTESTATION_NONCE_BYTES) {
    fail('INVALID_ATTESTATION_NONCE', 'attestation nonce must contain exactly 32 bytes');
  }
  if (!moduleSourceHashes
      || typeof moduleSourceHashes !== 'object'
      || Array.isArray(moduleSourceHashes)) {
    fail('INVALID_ATTESTATION_SOURCE_HASHES', 'moduleSourceHashes must be an object');
  }
  const modules = Object.fromEntries(
    Object.entries(moduleSourceHashes).sort(([left], [right]) => left.localeCompare(right)),
  );
  return validateAttestationManifest({
    type: ATTESTATION_MANIFEST_TYPE,
    nonce: nonce.toString('hex'),
    probeId,
    schemaSha256,
    sourceHashes: {
      bootstrapSha256: createHash('sha256').update(bootstrapBuffer).digest('hex'),
      modules,
    },
    expectedUrls: Object.keys(modules),
  });
}

function transcriptHmacInput(manifest, transcript) {
  return canonicalJsonBuffer({
    manifest,
    transcript,
  });
}

export function authenticateAttestationTranscript(key, manifest, transcript) {
  if (!Buffer.isBuffer(key) || key.length !== ATTESTATION_KEY_BYTES) {
    fail('INVALID_ATTESTATION_KEY', 'attestation HMAC key must contain exactly 32 bytes');
  }
  return createHmac('sha256', key)
    .update(transcriptHmacInput(manifest, transcript))
    .digest('hex');
}

function transcriptWithoutHmac(transcript) {
  const {
    type,
    nonce,
    probeId,
    rawEvidence,
    observedUrls,
    sourceHashes,
  } = transcript;
  return {
    type,
    nonce,
    probeId,
    rawEvidence,
    observedUrls,
    sourceHashes,
  };
}

export function verifyAttestationTranscript(frame, {
  key,
  manifest,
} = {}) {
  validateAttestationManifest(manifest);
  const transcript = decodeAttestationFrame(frame);
  if (!exactKeys(transcript, TRANSCRIPT_KEYS)
      || transcript.type !== ATTESTATION_TRANSCRIPT_TYPE
      || transcript.nonce !== manifest.nonce
      || transcript.probeId !== manifest.probeId
      || !Array.isArray(transcript.observedUrls)
      || !exactKeys(transcript.sourceHashes, ['bootstrapSha256', 'modules'])
      || typeof transcript.hmacSha256 !== 'string'
      || !SHA256_PATTERN.test(transcript.hmacSha256)) {
    fail('INVALID_ATTESTATION_TRANSCRIPT', 'attestation transcript fields do not match the manifest');
  }
  if (JSON.stringify(transcript.observedUrls) !== JSON.stringify(manifest.expectedUrls)) {
    fail('ATTESTATION_CLOSURE_MISMATCH', 'observed URLs must equal the current probe closure', {
      expected: manifest.expectedUrls,
      actual: transcript.observedUrls,
    });
  }
  if (!canonicalJsonBuffer(transcript.sourceHashes).equals(
    canonicalJsonBuffer(manifest.sourceHashes),
  )) {
    fail('ATTESTATION_SOURCE_HASH_MISMATCH', 'transcript source hashes differ from the manifest');
  }
  const actual = Buffer.from(transcript.hmacSha256, 'hex');
  const expected = Buffer.from(
    authenticateAttestationTranscript(
      key,
      manifest,
      transcriptWithoutHmac(transcript),
    ),
    'hex',
  );
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    fail('ATTESTATION_HMAC_MISMATCH', 'attestation transcript HMAC is invalid');
  }
  return transcript;
}

function normalizeLoadSource(source) {
  if (typeof source === 'string') return Buffer.from(source, 'utf8');
  if (Buffer.isBuffer(source)) return Buffer.from(source);
  if (source instanceof ArrayBuffer) return Buffer.from(source);
  if (ArrayBuffer.isView(source)) {
    return Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  }
  fail('ATTESTATION_SOURCE_UNAVAILABLE', 'nextLoad did not return normalizable source bytes');
}

function writeAllSync(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    offset += writeSync(fd, buffer, offset, buffer.length - offset);
  }
}

function readChildPipe(fd) {
  try {
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function certifiedBootstrapBuffer() {
  const prefix = 'data:text/javascript;base64,';
  if (!import.meta.url.startsWith(prefix)) {
    fail('UNCERTIFIED_ATTESTATION_BOOTSTRAP', 'attestation bootstrap must execute from a data URL');
  }
  const encoded = import.meta.url.slice(prefix.length);
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.toString('base64') !== encoded) {
    fail('UNCERTIFIED_ATTESTATION_BOOTSTRAP', 'attestation bootstrap data URL is not canonical base64');
  }
  return buffer;
}

function installStdoutCapture() {
  const chunks = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, encoding, callback) => {
    const resolvedEncoding = typeof encoding === 'string' ? encoding : undefined;
    chunks.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, resolvedEncoding));
    return original(chunk, encoding, callback);
  };
  return () => Buffer.concat(chunks);
}

function runCertifiedBootstrap() {
  if (!supportedNodeVersion(process.versions.node)
      || typeof nodeModule.registerHooks !== 'function') {
    fail(
      'UNSUPPORTED_ATTESTATION_RUNTIME',
      `attestation requires Node ${ATTESTATION_NODE_RANGE} with registerHooks`,
    );
  }
  const bootstrapBuffer = certifiedBootstrapBuffer();
  const key = readChildPipe(3);
  if (key.length !== ATTESTATION_KEY_BYTES) {
    fail('INVALID_ATTESTATION_KEY', 'fd3 requires exactly 32 key bytes followed by EOF', {
      length: key.length,
    });
  }
  const manifest = validateAttestationManifest(
    decodeAttestationFrame(readChildPipe(4)),
  );
  const bootstrapSha256 = createHash('sha256').update(bootstrapBuffer).digest('hex');
  if (bootstrapSha256 !== manifest.sourceHashes.bootstrapSha256) {
    fail('ATTESTATION_BOOTSTRAP_HASH_MISMATCH', 'data URL bytes differ from certified bootstrap');
  }

  const observed = new Map();
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      const output = nextLoad(url, context);
      if (!url.startsWith('file:')) return output;
      const expected = manifest.sourceHashes.modules[url];
      if (expected === undefined) {
        fail('UNDECLARED_ATTESTATION_LOAD', 'probe loaded an undeclared file URL', { url });
      }
      const hash = createHash('sha256')
        .update(normalizeLoadSource(output.source))
        .digest('hex');
      if (hash !== expected) {
        fail('ATTESTATION_SOURCE_HASH_MISMATCH', 'loaded source bytes differ from the manifest', {
          url,
          expected,
          actual: hash,
        });
      }
      observed.set(url, hash);
      return output;
    },
  });

  const capturedStdout = installStdoutCapture();
  let finalized = false;
  process.once('beforeExit', () => {
    if (finalized) return;
    finalized = true;
    try {
      const raw = capturedStdout().toString('utf8').trim();
      if (raw.length === 0) {
        fail('MISSING_ATTESTATION_EVIDENCE', 'probe emitted no JSON evidence on stdout');
      }
      let rawEvidence;
      try {
        rawEvidence = JSON.parse(raw);
      } catch (error) {
        fail('INVALID_ATTESTATION_EVIDENCE', 'probe stdout is not exactly one JSON value', {
          cause: error instanceof Error ? error.message : String(error),
        });
      }
      const observedUrls = [...observed.keys()].sort();
      const modules = Object.fromEntries(
        [...observed.entries()].sort(([left], [right]) => left.localeCompare(right)),
      );
      const unsigned = {
        type: ATTESTATION_TRANSCRIPT_TYPE,
        nonce: manifest.nonce,
        probeId: manifest.probeId,
        rawEvidence,
        observedUrls,
        sourceHashes: {
          bootstrapSha256,
          modules,
        },
      };
      const transcript = {
        ...unsigned,
        hmacSha256: authenticateAttestationTranscript(key, manifest, unsigned),
      };
      writeAllSync(5, encodeAttestationFrame(transcript));
      closeSync(5);
      if (JSON.stringify(observedUrls) !== JSON.stringify(manifest.expectedUrls)) {
        process.exitCode = 1;
      }
    } catch (error) {
      try {
        closeSync(5);
      } catch {
        // fd5 may already be closed after a completed transcript.
      }
      writeSync(
        2,
        Buffer.from(
          `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
          'utf8',
        ),
      );
      process.exitCode = 1;
    }
  });
}

function collectStream(stream, label) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let length = 0;
    stream.on('data', chunk => {
      const buffer = Buffer.from(chunk);
      length += buffer.length;
      if (length > ATTESTATION_FRAME_MAX_BYTES) {
        reject(new ModuleAttestationError(
          'ATTESTATION_CHANNEL_TOO_LARGE',
          `${label} exceeded the fixed byte limit`,
        ));
        stream.destroy();
        return;
      }
      chunks.push(buffer);
    });
    stream.once('error', reject);
    stream.once('end', () => resolvePromise(Buffer.concat(chunks)));
  });
}

function writeParentPipe(stream, bytes, label) {
  return new Promise((resolvePromise, reject) => {
    stream.once('error', reject);
    stream.end(bytes, error => {
      if (error) reject(error);
      else resolvePromise();
    });
  }).catch(error => {
    fail('ATTESTATION_PARENT_WRITE_FAILED', `${label} write or EOF failed`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  });
}

function waitForChild(child) {
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', (status, signal) => resolvePromise({ status, signal }));
  });
}

export async function runCertifiedAttestedChild({
  args,
  cwd,
  projectRoot = cwd,
  bootstrapBuffer,
  manifest,
  parentEnvironment = process.env,
  spawn = spawnChild,
  timeoutMs = 120_000,
} = {}) {
  await assertCertifiedAttestationRuntime();
  if (!Array.isArray(args) || !args.every(arg => typeof arg === 'string')) {
    fail('INVALID_ATTESTATION_CHILD_ARGS', 'attested child args must be strings');
  }
  if (!isAbsolute(cwd) || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    fail('INVALID_ATTESTATION_CHILD_OPTIONS', 'attested child requires absolute cwd and timeout');
  }
  if (!Buffer.isBuffer(bootstrapBuffer)) {
    fail(
      'UNCERTIFIED_ATTESTATION_BOOTSTRAP',
      'attestation bootstrap must be the retained certified Buffer; paths are forbidden',
    );
  }
  validateAttestationManifest(manifest);
  const bootstrapSha256 = createHash('sha256').update(bootstrapBuffer).digest('hex');
  if (bootstrapSha256 !== manifest.sourceHashes.bootstrapSha256) {
    fail('ATTESTATION_BOOTSTRAP_HASH_MISMATCH', 'bootstrap Buffer does not match the manifest');
  }
  const key = randomBytes(ATTESTATION_KEY_BYTES);
  const bootstrapUrl =
    `data:text/javascript;base64,${bootstrapBuffer.toString('base64')}`;
  const childArgs = ['--import', bootstrapUrl, ...args];
  const child = spawn(process.execPath, childArgs, {
    shell: false,
    cwd,
    env: sanitizeAttestationEnvironment(parentEnvironment, { projectRoot }),
    stdio: [...ATTESTATION_STDIO],
    windowsHide: true,
  });
  if (!child.stdout || !child.stderr
      || !child.stdio?.[3] || !child.stdio?.[4] || !child.stdio?.[5]) {
    child.kill();
    fail('ATTESTATION_STDIO_UNAVAILABLE', 'attested child did not expose fd1-fd5 pipes');
  }

  const stdoutPromise = collectStream(child.stdout, 'stdout');
  const stderrPromise = collectStream(child.stderr, 'stderr');
  const transcriptPromise = collectStream(child.stdio[5], 'fd5');
  const exitPromise = waitForChild(child);
  const keyWrite = writeParentPipe(child.stdio[3], key, 'fd3');
  const manifestWrite = writeParentPipe(
    child.stdio[4],
    encodeAttestationFrame(manifest),
    'fd4',
  );

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      child.kill();
      reject(new ModuleAttestationError(
        'ATTESTATION_TIMEOUT',
        'attested child did not complete protocol and close all channels',
      ));
    }, timeoutMs);
  });
  let settled;
  try {
    settled = await Promise.race([
      Promise.all([
        stdoutPromise,
        stderrPromise,
        transcriptPromise,
        exitPromise,
        keyWrite,
        manifestWrite,
      ]),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
  const [stdout, stderr, transcriptFrame, exit] = settled;
  const transcript = verifyAttestationTranscript(transcriptFrame, { key, manifest });
  if (exit.status !== 0 || exit.signal !== null) {
    fail('ATTESTATION_CHILD_FAILED', 'attested child exit did not match a valid transcript', {
      status: exit.status,
      signal: exit.signal,
      stderr: stderr.toString('utf8'),
    });
  }
  return {
    transcript,
    stdout,
    stderr,
    trace: {
      command: process.execPath,
      args: childArgs,
      cwd,
      shell: false,
      stdio: [...ATTESTATION_STDIO],
      environmentKeys: Object.keys(
        sanitizeAttestationEnvironment(parentEnvironment, { projectRoot }),
      ).sort(),
      status: exit.status,
      signal: exit.signal,
      stdoutBytes: stdout.length,
      stderrBytes: stderr.length,
      transcriptBytes: transcriptFrame.length,
      bootstrapSha256,
    },
  };
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function containedPath(root, target) {
  const nested = relative(root, target);
  return nested === '' || (
    nested !== '..'
    && !nested.startsWith(`..${sep}`)
    && !isAbsolute(nested)
  );
}

function canonicalRoot(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || !existsSync(path)) {
    fail('INVALID_CERTIFIED_ROOT', 'certified roots must be existing absolute directories', {
      path,
    });
  }
  const canonical = realpathSync(path);
  if (!statSync(canonical).isDirectory()) {
    fail('INVALID_CERTIFIED_ROOT', 'certified roots must be directories', { path });
  }
  return canonical;
}

function canonicalRoots(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    fail('INVALID_CERTIFIED_ROOT', 'at least one certified root is required');
  }
  return [...new Set(paths.map(canonicalRoot))];
}

function assertContainedFile(path, roots, context) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    fail('MODULE_RESOLUTION_FAILED', 'module specifier did not resolve to a regular file', {
      ...context,
      path,
    });
  }
  const canonical = realpathSync(path);
  if (!roots.some(root => containedPath(root, canonical))) {
    fail('MODULE_RESOLUTION_ESCAPE', 'resolved module escapes every certified root', {
      ...context,
      path,
      canonical,
      certified_roots: roots,
    });
  }
  return {
    kind: 'file',
    path: canonical,
    url: pathToFileURL(canonical).href,
  };
}

function candidateFiles(path) {
  const candidates = [];
  if (existsSync(path) && statSync(path).isFile()) candidates.push(path);
  if (extname(path) === '') {
    for (const suffix of ['.js', '.mjs', '.cjs', '.json', '.node']) {
      const candidate = `${path}${suffix}`;
      if (existsSync(candidate) && statSync(candidate).isFile()) candidates.push(candidate);
    }
    if (existsSync(path) && statSync(path).isDirectory()) {
      for (const name of ['index.js', 'index.mjs', 'index.cjs', 'index.json', 'index.node']) {
        const candidate = join(path, name);
        if (existsSync(candidate) && statSync(candidate).isFile()) candidates.push(candidate);
      }
    }
  }
  return [...new Set(candidates.map(candidate => realpathSync(candidate)))];
}

function nearestPackage(callerPath) {
  let directory = dirname(callerPath);
  while (true) {
    const packagePath = join(directory, 'package.json');
    if (existsSync(packagePath) && statSync(packagePath).isFile()) {
      let body;
      try {
        body = JSON.parse(readFileSync(packagePath, 'utf8'));
      } catch (error) {
        fail('INVALID_PACKAGE_IMPORTS', 'cannot parse package.json for package import resolution', {
          packagePath,
          cause: error instanceof Error ? error.message : String(error),
        });
      }
      return { directory, packagePath, body };
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function resolvePackageImport(specifier, callerPath) {
  const packageInfo = nearestPackage(callerPath);
  const imports = packageInfo?.body?.imports;
  if (!imports || typeof imports !== 'object' || Array.isArray(imports)) {
    fail('MODULE_RESOLUTION_FAILED', 'package import has no imports mapping', {
      caller: callerPath,
      specifier,
    });
  }

  const matches = [];
  for (const [key, target] of Object.entries(imports)) {
    if (typeof target !== 'string' || !target.startsWith('./')) continue;
    if (key === specifier) {
      matches.push(target);
      continue;
    }
    const star = key.indexOf('*');
    if (star < 0 || key.indexOf('*', star + 1) >= 0) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    const capture = specifier.slice(prefix.length, specifier.length - suffix.length);
    matches.push(target.replace('*', capture));
  }
  if (matches.length !== 1) {
    fail(
      matches.length === 0 ? 'MODULE_RESOLUTION_FAILED' : 'AMBIGUOUS_MODULE_RESOLUTION',
      'package import must resolve through exactly one literal mapping',
      {
        caller: callerPath,
        specifier,
        matches,
        packagePath: packageInfo?.packagePath ?? null,
      },
    );
  }
  return resolve(packageInfo.directory, matches[0]);
}

function packageSpecifierParts(specifier) {
  const segments = specifier.split('/');
  const packageName = specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : segments[0];
  const consumed = specifier.startsWith('@') ? 2 : 1;
  const subpath = segments.length === consumed
    ? '.'
    : `./${segments.slice(consumed).join('/')}`;
  return { packageName, subpath };
}

function findInstalledPackage(callerPath, packageName) {
  let directory = dirname(callerPath);
  while (true) {
    const packageRoot = join(directory, 'node_modules', packageName);
    const packagePath = join(packageRoot, 'package.json');
    if (existsSync(packagePath) && statSync(packagePath).isFile()) {
      let body;
      try {
        body = JSON.parse(readFileSync(packagePath, 'utf8'));
      } catch (error) {
        fail('INVALID_PACKAGE_IMPORTS', 'cannot parse installed package manifest', {
          packagePath,
          cause: error instanceof Error ? error.message : String(error),
        });
      }
      return { packageRoot, packagePath, body };
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function conditionalExportTarget(target, context) {
  if (typeof target === 'string') return target;
  if (Array.isArray(target)) {
    const choices = target
      .map(choice => conditionalExportTarget(choice, context))
      .filter(choice => choice !== null);
    if (choices.length !== 1) {
      fail('AMBIGUOUS_MODULE_RESOLUTION', 'package export array must have one import target', {
        ...context,
        choices,
      });
    }
    return choices[0];
  }
  if (!target || typeof target !== 'object') return null;
  for (const [condition, value] of Object.entries(target)) {
    if (!['node', 'import', 'default'].includes(condition)) continue;
    const selected = conditionalExportTarget(value, context);
    if (selected !== null) return selected;
  }
  return null;
}

function packageExportTarget(exportsField, subpath, context) {
  if (typeof exportsField === 'string' || Array.isArray(exportsField)) {
    return subpath === '.' ? conditionalExportTarget(exportsField, context) : null;
  }
  if (!exportsField || typeof exportsField !== 'object') return null;
  const keys = Object.keys(exportsField);
  if (!keys.some(key => key.startsWith('.'))) {
    return subpath === '.' ? conditionalExportTarget(exportsField, context) : null;
  }
  if (Object.hasOwn(exportsField, subpath)) {
    return conditionalExportTarget(exportsField[subpath], context);
  }
  const patterns = keys
    .filter(key => key.includes('*'))
    .map(key => {
      const star = key.indexOf('*');
      const prefix = key.slice(0, star);
      const suffix = key.slice(star + 1);
      if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) return null;
      return {
        key,
        capture: subpath.slice(prefix.length, subpath.length - suffix.length),
        specificity: prefix.length + suffix.length,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.specificity - left.specificity);
  if (patterns.length === 0) return null;
  if (patterns.length > 1 && patterns[0].specificity === patterns[1].specificity) {
    fail('AMBIGUOUS_MODULE_RESOLUTION', 'package export matches multiple equal patterns', {
      ...context,
      patterns: patterns.map(pattern => pattern.key),
    });
  }
  const selected = conditionalExportTarget(exportsField[patterns[0].key], context);
  return selected?.replaceAll('*', patterns[0].capture) ?? null;
}

function resolveBareImport(specifier, callerPath) {
  const { packageName, subpath } = packageSpecifierParts(specifier);
  const installed = findInstalledPackage(callerPath, packageName);
  if (!installed) {
    fail('MODULE_RESOLUTION_FAILED', 'bare module package is not installed', {
      caller: callerPath,
      specifier,
      packageName,
    });
  }
  const context = {
    caller: callerPath,
    specifier,
    packagePath: installed.packagePath,
  };
  let target;
  if (installed.body.exports !== undefined) {
    target = packageExportTarget(installed.body.exports, subpath, context);
    if (target === null) {
      fail('MODULE_RESOLUTION_FAILED', 'package exports do not expose the requested subpath', {
        ...context,
        subpath,
      });
    }
  } else if (subpath !== '.') {
    target = subpath;
  } else {
    target = typeof installed.body.main === 'string'
      ? installed.body.main
      : './index.js';
  }
  if (typeof target !== 'string' || !target.startsWith('./')) {
    fail('MODULE_RESOLUTION_ESCAPE', 'package export target must be package-relative', {
      ...context,
      target,
    });
  }
  return resolve(installed.packageRoot, target);
}

function unresolvedPath(callerPath, specifier) {
  if (specifier.startsWith('file:')) return fileURLToPath(specifier);
  if (specifier.startsWith('#')) return resolvePackageImport(specifier, callerPath);
  if (specifier.startsWith('.') || isAbsolute(specifier)) {
    return specifier.startsWith('.')
      ? resolve(dirname(callerPath), specifier)
      : resolve(specifier);
  }
  return resolveBareImport(specifier, callerPath);
}

export function resolveRuntimeModule(callerUrl, specifier, {
  certifiedRoots: rootsInput,
} = {}) {
  const roots = canonicalRoots(rootsInput);
  if (typeof callerUrl !== 'string' || !callerUrl.startsWith('file:')) {
    fail('INVALID_CALLER_URL', 'module caller must be a canonical file URL', { callerUrl });
  }
  if (typeof specifier !== 'string' || specifier.length === 0) {
    fail('MODULE_RESOLUTION_FAILED', 'module specifier must be a non-empty string', {
      caller: callerUrl,
      specifier,
    });
  }
  if (specifier.startsWith('node:') || BUILTINS.has(specifier)) {
    return { kind: 'builtin', url: specifier };
  }

  const callerPath = fileURLToPath(callerUrl);
  const canonicalCaller = assertContainedFile(callerPath, roots, {
    caller: callerUrl,
    specifier,
  });
  if (canonicalCaller.url !== callerUrl) {
    fail('NONCANONICAL_CALLER_URL', 'module caller URL is not canonical', {
      expected: canonicalCaller.url,
      actual: callerUrl,
    });
  }

  const unresolved = unresolvedPath(callerPath, specifier);
  if (BUILTINS.has(unresolved)) return { kind: 'builtin', url: unresolved };
  const candidates = candidateFiles(unresolved);
  if (candidates.length !== 1) {
    fail(
      candidates.length === 0 ? 'MODULE_RESOLUTION_FAILED' : 'AMBIGUOUS_MODULE_RESOLUTION',
      'module specifier must resolve to exactly one runtime file',
      {
        caller: callerUrl,
        specifier,
        unresolved,
        candidates,
      },
    );
  }
  return assertContainedFile(candidates[0], roots, {
    caller: callerUrl,
    specifier,
  });
}

function getTypeScript() {
  if (typeScript === undefined) {
    const require = nodeModule.createRequire(import.meta.url);
    typeScript = require('typescript');
  }
  return typeScript;
}

function scriptKind(url) {
  const ts = getTypeScript();
  const extension = extname(fileURLToPath(url)).toLowerCase();
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') {
    return ts.ScriptKind.TS;
  }
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.json') return ts.ScriptKind.JSON;
  return ts.ScriptKind.JS;
}

function literalSpecifier(node) {
  const ts = getTypeScript();
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : null;
}

function runtimeImportDeclaration(node) {
  const ts = getTypeScript();
  if (!node.importClause) return true;
  if (node.importClause.isTypeOnly) return false;
  const bindings = node.importClause.namedBindings;
  return !bindings
    || !ts.isNamedImports(bindings)
    || bindings.elements.some(element => !element.isTypeOnly)
    || Boolean(node.importClause.name);
}

export function parseModuleEdges(moduleUrl, {
  certifiedRoots: rootsInput,
} = {}) {
  const ts = getTypeScript();
  const roots = canonicalRoots(rootsInput);
  const modulePath = fileURLToPath(moduleUrl);
  const canonical = assertContainedFile(modulePath, roots, { caller: moduleUrl });
  if (canonical.url !== moduleUrl) {
    fail('NONCANONICAL_CALLER_URL', 'module URL is not canonical', {
      expected: canonical.url,
      actual: moduleUrl,
    });
  }
  const source = readFileSync(canonical.path, 'utf8');
  const sourceFile = ts.createSourceFile(
    canonical.path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(moduleUrl),
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    fail('MODULE_PARSE_FAILED', 'module contains TypeScript parse diagnostics', {
      caller: moduleUrl,
      diagnostics: sourceFile.parseDiagnostics.map(diagnostic => diagnostic.messageText),
    });
  }

  const staticSpecifiers = new Set();
  const dynamicSpecifiers = new Set();
  const visit = node => {
    if (ts.isImportDeclaration(node)
        && runtimeImportDeclaration(node)
        && literalSpecifier(node.moduleSpecifier) !== null) {
      staticSpecifiers.add(literalSpecifier(node.moduleSpecifier));
    } else if (ts.isExportDeclaration(node)
        && !node.isTypeOnly
        && node.moduleSpecifier
        && literalSpecifier(node.moduleSpecifier) !== null) {
      staticSpecifiers.add(literalSpecifier(node.moduleSpecifier));
    } else if (ts.isCallExpression(node)
        && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (node.arguments.length !== 1 || literalSpecifier(node.arguments[0]) === null) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        fail('NONLITERAL_DYNAMIC_IMPORT', 'every dynamic import must have one literal specifier', {
          caller: moduleUrl,
          line: position.line + 1,
          column: position.character + 1,
          expression: node.getText(sourceFile),
        });
      }
      dynamicSpecifiers.add(literalSpecifier(node.arguments[0]));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const resolveEdge = specifier => {
    const resolution = resolveRuntimeModule(moduleUrl, specifier, {
      certifiedRoots: roots,
    });
    return {
      caller: moduleUrl,
      specifier,
      resolved_url: resolution.url,
      kind: resolution.kind,
    };
  };
  return {
    url: moduleUrl,
    static_edges: sorted(staticSpecifiers).map(resolveEdge),
    dynamic_edges: sorted(dynamicSpecifiers).map(resolveEdge),
  };
}

function manifestLocation(value, roots, manifestBase, field) {
  if (typeof value !== 'string' || value.length === 0) {
    fail('INVALID_DYNAMIC_EDGE_MANIFEST', `manifest ${field} must be a non-empty string`);
  }
  const path = value.startsWith('file:')
    ? fileURLToPath(value)
    : resolve(manifestBase, value);
  return assertContainedFile(path, roots, { field, value }).url;
}

function validateManifest(manifest, probes, roots, manifestBase) {
  if (!Array.isArray(manifest)) {
    fail('INVALID_DYNAMIC_EDGE_MANIFEST', 'dynamic-edge manifest must be an array of rows');
  }
  const probeById = new Map(probes.map(probe => [probe.probeId, probe]));
  const seenRows = new Set();
  const seenEdges = new Set();
  const normalized = [];
  for (let index = 0; index < manifest.length; index += 1) {
    const row = manifest[index];
    if (!row || typeof row !== 'object' || Array.isArray(row)
        || JSON.stringify(Object.keys(row).sort()) !== JSON.stringify([...ROW_KEYS].sort())) {
      fail('INVALID_DYNAMIC_EDGE_MANIFEST', 'manifest rows must contain exactly the required fields', {
        index,
        required: ROW_KEYS,
        actual: row && typeof row === 'object' ? Object.keys(row) : null,
      });
    }
    const probe = probeById.get(row.probe_id);
    if (!probe) {
      fail('UNKNOWN_DYNAMIC_EDGE_PROBE', 'manifest row names an unknown probe', {
        index,
        probe_id: row.probe_id,
      });
    }
    if (typeof row.specifier !== 'string' || row.specifier.length === 0
        || typeof row.guard !== 'string' || row.guard.length === 0) {
      fail('INVALID_DYNAMIC_EDGE_MANIFEST', 'manifest specifier and guard must be non-empty', {
        index,
      });
    }
    if (!Object.hasOwn(probe.guards, row.guard)) {
      fail('UNKNOWN_DYNAMIC_EDGE_GUARD', 'manifest row names an unknown guard', {
        index,
        probe_id: row.probe_id,
        guard: row.guard,
      });
    }
    const forbidden = probe.forbiddenGuards ?? [];
    if (forbidden.includes(row.guard)) {
      fail('FORBIDDEN_DYNAMIC_EDGE_GUARD', 'probe manifest contains a forbidden guard', {
        index,
        probe_id: row.probe_id,
        guard: row.guard,
      });
    }

    const caller = manifestLocation(row.caller, roots, manifestBase, 'caller');
    const resolvedUrl = manifestLocation(
      row.resolved_url,
      roots,
      manifestBase,
      'resolved_url',
    );
    const resolution = resolveRuntimeModule(caller, row.specifier, {
      certifiedRoots: roots,
    });
    if (resolution.kind !== 'file' || resolution.url !== resolvedUrl) {
      fail('DYNAMIC_EDGE_RESOLUTION_MISMATCH', 'manifest resolved_url does not match runtime resolution', {
        index,
        expected: resolution.url,
        actual: resolvedUrl,
      });
    }

    const normalizedRow = {
      probe_id: row.probe_id,
      caller,
      specifier: row.specifier,
      resolved_url: resolvedUrl,
      guard: row.guard,
    };
    const rowKey = ROW_KEYS.map(key => normalizedRow[key]).join('\0');
    if (seenRows.has(rowKey)) {
      fail('DUPLICATE_DYNAMIC_EDGE_ROW', 'dynamic-edge manifest contains a duplicate row', {
        index,
        row: normalizedRow,
      });
    }
    seenRows.add(rowKey);
    const edgeKey = [row.probe_id, caller, row.specifier].join('\0');
    if (seenEdges.has(edgeKey)) {
      fail('AMBIGUOUS_DYNAMIC_EDGE_ROW', 'a probe edge may have only one manifest row', {
        index,
        row: normalizedRow,
      });
    }
    seenEdges.add(edgeKey);
    normalized.push(normalizedRow);
  }
  return normalized;
}

function normalizeProbes(probesInput, roots) {
  if (!Array.isArray(probesInput) || probesInput.length === 0) {
    fail('INVALID_PROBE_CONFIGURATION', 'at least one probe is required');
  }
  const seen = new Set();
  return probesInput.map((probe, index) => {
    if (!probe || typeof probe !== 'object' || Array.isArray(probe)
        || typeof probe.probeId !== 'string' || probe.probeId.length === 0
        || typeof probe.entry !== 'string' || probe.entry.length === 0
        || !probe.guards || typeof probe.guards !== 'object' || Array.isArray(probe.guards)) {
      fail('INVALID_PROBE_CONFIGURATION', 'probe requires probeId, entry, and guards', {
        index,
      });
    }
    if (seen.has(probe.probeId)) {
      fail('INVALID_PROBE_CONFIGURATION', 'probe IDs must be unique', {
        probeId: probe.probeId,
      });
    }
    seen.add(probe.probeId);
    for (const [guard, value] of Object.entries(probe.guards)) {
      if (!guard || typeof value !== 'boolean') {
        fail('INVALID_PROBE_CONFIGURATION', 'probe guards must map names to booleans', {
          probeId: probe.probeId,
          guard,
          value,
        });
      }
    }
    const entryPath = typeof probe.entry === 'string' && probe.entry.startsWith('file:')
      ? fileURLToPath(probe.entry)
      : probe.entry;
    const entry = assertContainedFile(entryPath, roots, {
      probeId: probe.probeId,
      field: 'entry',
    }).url;
    return {
      probeId: probe.probeId,
      entry,
      guards: { ...probe.guards },
      forbiddenGuards: probe.forbiddenGuards
        ?? (probe.probeId === 'read-only-probe' ? READ_ONLY_FORBIDDEN_GUARDS : []),
    };
  });
}

function edgeKey(edge) {
  return [edge.caller, edge.specifier, edge.resolved_url].join('\0');
}

function deriveOneProbe(probe, rows, roots) {
  const parsed = new Map();
  const expected = new Set();
  const initialStatic = new Set();
  const possible = new Map();

  const parse = url => {
    if (!parsed.has(url)) {
      parsed.set(url, parseModuleEdges(url, { certifiedRoots: roots }));
    }
    return parsed.get(url);
  };
  const visitStatic = (url, collection) => {
    if (collection.has(url)) return;
    collection.add(url);
    expected.add(url);
    const edges = parse(url);
    for (const edge of edges.dynamic_edges) possible.set(edgeKey(edge), edge);
    for (const edge of edges.static_edges) {
      if (edge.kind === 'file') visitStatic(edge.resolved_url, collection);
    }
  };
  visitStatic(probe.entry, initialStatic);

  const trueRows = rows.filter(row => probe.guards[row.guard]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of trueRows) {
      if (!expected.has(row.caller)) continue;
      const key = edgeKey(row);
      if (!possible.has(key)) continue;
      if (!expected.has(row.resolved_url)) {
        const addedStatic = new Set();
        visitStatic(row.resolved_url, addedStatic);
        changed = true;
      }
    }
  }

  for (const row of rows) {
    if (!expected.has(row.caller) || !possible.has(edgeKey(row))) {
      fail('UNDECLARED_DYNAMIC_EDGE', 'manifest row is not a literal edge reachable for its probe', {
        probe_id: probe.probeId,
        row,
        caller_reachable: expected.has(row.caller),
      });
    }
  }

  return {
    probe_id: probe.probeId,
    entry_url: probe.entry,
    static_closure: sorted(initialStatic),
    possible_dynamic_edges: [...possible.values()]
      .map(({ caller, specifier, resolved_url }) => ({ caller, specifier, resolved_url }))
      .sort((left, right) => edgeKey(left).localeCompare(edgeKey(right))),
    permitted_dynamic_edges: trueRows
      .map(row => ({ ...row }))
      .sort((left, right) => edgeKey(left).localeCompare(edgeKey(right))),
    expected_urls: sorted(expected),
  };
}

export function deriveProbeModuleAttestation({
  certifiedRoots: rootsInput,
  probes: probesInput,
  manifest,
  manifestBase,
} = {}) {
  const roots = canonicalRoots(rootsInput);
  const probes = normalizeProbes(probesInput, roots);
  if (manifestBase !== undefined
      && (typeof manifestBase !== 'string'
        || !isAbsolute(manifestBase)
        || !existsSync(manifestBase))) {
    fail('INVALID_DYNAMIC_EDGE_MANIFEST', 'manifest base must be an existing absolute directory', {
      manifestBase,
    });
  }
  const base = manifestBase === undefined ? roots[0] : realpathSync(manifestBase);
  if (!statSync(base).isDirectory()) {
    fail('INVALID_DYNAMIC_EDGE_MANIFEST', 'manifest base must be an existing directory', {
      manifestBase,
    });
  }
  if (!roots.some(root => containedPath(root, base))) {
    fail('MODULE_RESOLUTION_ESCAPE', 'manifest base escapes every certified root', {
      manifestBase,
      canonical: base,
    });
  }
  const rows = validateManifest(manifest, probes, roots, base);
  const results = {};
  for (const probe of probes) {
    results[probe.probeId] = deriveOneProbe(
      probe,
      rows.filter(row => row.probe_id === probe.probeId),
      roots,
    );
  }
  return {
    schema_version: DYNAMIC_EDGE_MANIFEST_SCHEMA,
    certified_roots: roots.map(root => pathToFileURL(root).href),
    manifest_rows: rows,
    probes: results,
  };
}

export function loadProbeDynamicEdgeManifest(path) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail('INVALID_DYNAMIC_EDGE_MANIFEST', 'cannot parse dynamic-edge manifest JSON', {
      path,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!Array.isArray(manifest)) {
    fail('INVALID_DYNAMIC_EDGE_MANIFEST', 'dynamic-edge manifest JSON must be an array');
  }
  return manifest;
}

if (import.meta.url.startsWith('data:text/javascript;base64,')) {
  runCertifiedBootstrap();
}

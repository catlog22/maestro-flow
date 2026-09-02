import { afterAll } from 'vitest';

// Vitest reuses fork workers across files. Snapshot process-global state before
// each test module loads, then restore it when that file finishes so one suite
// cannot redirect later suites to its temporary workspace.
const originalEnvironment = { ...process.env };
const originalCwd = process.cwd();
const originalExitCode = process.exitCode;

afterAll(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (process.cwd() !== originalCwd) process.chdir(originalCwd);
  process.exitCode = originalExitCode;
});

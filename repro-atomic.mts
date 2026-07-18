import { mkdtempSync, rmSync, readdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendSpecEntry } from './src/tools/spec-writer.js';

const dir = mkdtempSync(join(tmpdir(), 'repro-atomic-'));
const t0 = Date.now();
const res = appendSpecEntry(dir, 'coding', 'Repro Rule', 'some content', ['x']);
console.log('append took', Date.now() - t0, 'ms →', JSON.stringify(res).slice(0, 120));

const specsDir = join(dir, '.workflow', 'specs');
let files: string[] = [];
try { files = readdirSync(specsDir); } catch (e) { console.log('readdir specs failed:', (e as Error).message); }
console.log('specs dir contents:', files);

for (const f of files) {
  const p = join(specsDir, f);
  const t = Date.now();
  try { unlinkSync(p); console.log('unlink OK', f, Date.now() - t, 'ms'); }
  catch (e) { console.log('unlink FAIL', f, (e as NodeJS.ErrnoException).code, Date.now() - t, 'ms'); }
}
const t1 = Date.now();
try { rmSync(dir, { recursive: true, force: true }); console.log('rmSync OK', Date.now() - t1, 'ms'); }
catch (e) {
  console.log('rmSync FAIL', (e as NodeJS.ErrnoException).code, (e as NodeJS.ErrnoException).path, Date.now() - t1, 'ms');
  const t2 = Date.now();
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); console.log('rmSync retry OK after', Date.now() - t2, 'ms'); }
  catch (e2) { console.log('rmSync retry FAIL', (e2 as NodeJS.ErrnoException).code, (e2 as NodeJS.ErrnoException).path); }
}

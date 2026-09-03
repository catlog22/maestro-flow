import { parentPort } from 'node:worker_threads';
import type { Language } from '../../db/types.js';
import { getTreeSitterEngine } from './tree-sitter.js';
import { getExtractor } from './languages/index.js';
import { treeReportsError, withPartialParseDiagnostics } from './partial-parse.js';

interface ExtractRequest {
  type: 'extract';
  id: number;
  sourceCode: string;
  language: Language;
  filePath: string;
}

{
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((err?: Error | null) => void), cb?: (err?: Error | null) => void): boolean => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    if (text.startsWith('Aborted(') || text.includes('Build with -sASSERTIONS for more info') || text.includes('Cannot enlarge memory arrays') || text.includes('RuntimeError: unreachable')) {
      if (typeof encoding === 'function') encoding();
      else if (cb) cb();
      return true;
    }
    return originalWrite(chunk as never, encoding as never, cb as never);
  }) as typeof process.stderr.write;
}

parentPort?.on('message', async (message: ExtractRequest | { type: 'shutdown' }) => {
  if (message.type === 'shutdown') {
    parentPort?.postMessage({ type: 'shutdown-ack' });
    return;
  }

  try {
    const extractor = getExtractor(message.language);
    if (!extractor) {
      parentPort?.postMessage({ type: 'extract-result', id: message.id, ok: false, error: `No extractor for ${message.language}` });
      return;
    }

    const tree = await getTreeSitterEngine().parse(message.sourceCode, message.language);
    if (!tree) {
      parentPort?.postMessage({ type: 'extract-result', id: message.id, ok: false, error: 'tree-sitter parse failed' });
      return;
    }

    try {
      const result = extractor.extract(tree, message.sourceCode, message.filePath);
      withPartialParseDiagnostics(result, message.language, message.filePath, treeReportsError(tree));
      parentPort?.postMessage({ type: 'extract-result', id: message.id, ok: true, result });
    } finally {
      tree.delete();
    }
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (text.includes('memory access out of bounds') || text.toLowerCase().includes('out of memory') || text.includes('Cannot enlarge memory arrays') || text.includes('RuntimeError: unreachable')) {
      process.exit(1);
    }
    parentPort?.postMessage({ type: 'extract-result', id: message.id, ok: false, error: text });
  }
});

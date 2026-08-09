import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MaestroGraph } from '../engine.js';
import { syncKnowledgeGraph } from '../extraction/orchestrator.js';

describe('MaestroGraph extraction orchestrator', () => {
  it('indexes the project root by default and lets ignore rules exclude paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-orchestrator-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(join(root, 'tauri', 'src-tauri'), { recursive: true });
      mkdirSync(join(root, 'ignored'), { recursive: true });
      writeFileSync(join(root, '.maestroignore'), 'ignored/\n');
      writeFileSync(join(root, 'src', 'app.yml'), 'service:\n  name: app\n');
      writeFileSync(join(root, 'tauri', 'src-tauri', 'app.yml'), 'service:\n  name: tauri\n');
      writeFileSync(join(root, 'ignored', 'app.yml'), 'service:\n  name: ignored\n');

      const results = await syncKnowledgeGraph(root, {
        sources: ['codegraph'],
        codegraph: { createMaestroIgnore: false },
      });
      const codegraphResult = results.find(result => result.source === 'codegraph');

      expect(codegraphResult?.nodesAdded).toBe(2);

      const graph = await MaestroGraph.open(root);
      try {
        const canonicalRoot = realpathSync(root);
        const files = graph
          .getQueryBuilder()
          .getNodesBySourceType('codegraph')
          .map(node => node.filePath)
          .sort();

        expect(files).toEqual([
          join(canonicalRoot, 'src', 'app.yml'),
          join(canonicalRoot, 'tauri', 'src-tauri', 'app.yml'),
        ]);
      } finally {
        graph.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('canonicalizes a symlinked project root before applying .gitignore rules', async () => {
    const container = mkdtempSync(join(tmpdir(), 'maestro-orchestrator-alias-'));
    const actualRoot = join(container, 'actual');
    const aliasRoot = join(container, 'project');
    try {
      mkdirSync(actualRoot, { recursive: true });
      const canonicalActualRoot = realpathSync(actualRoot);
      symlinkSync(actualRoot, aliasRoot, 'dir');
      mkdirSync(join(actualRoot, 'src'), { recursive: true });
      mkdirSync(join(actualRoot, 'tauri', 'src-tauri'), { recursive: true });
      mkdirSync(join(actualRoot, 'ignored'), { recursive: true });
      writeFileSync(join(actualRoot, '.gitignore'), 'ignored/\n');
      writeFileSync(join(actualRoot, 'src', 'app.yml'), 'service:\n  name: app\n');
      writeFileSync(join(actualRoot, 'tauri', 'src-tauri', 'app.yml'), 'service:\n  name: tauri\n');
      writeFileSync(join(actualRoot, 'ignored', 'app.yml'), 'service:\n  name: ignored\n');

      const results = await syncKnowledgeGraph(aliasRoot, {
        sources: ['codegraph'],
        codegraph: { createMaestroIgnore: false },
      });
      const codegraphResult = results.find(result => result.source === 'codegraph');

      expect(realpathSync(aliasRoot)).toBe(canonicalActualRoot);
      expect(codegraphResult?.nodesAdded).toBe(2);

      const graph = await MaestroGraph.open(aliasRoot);
      try {
        const files = graph
          .getQueryBuilder()
          .getNodesBySourceType('codegraph')
          .map(node => node.filePath)
          .sort();

        expect(files).toEqual([
          join(canonicalActualRoot, 'src', 'app.yml'),
          join(canonicalActualRoot, 'tauri', 'src-tauri', 'app.yml'),
        ]);
      } finally {
        graph.close();
      }
    } finally {
      rmSync(container, { recursive: true, force: true });
    }
  });
});

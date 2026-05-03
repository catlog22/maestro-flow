import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParentDir, resolveSubPath, buildTree } from './BlueprintPreview.logic.js';
import type { ComponentDef } from '../install-backend.js';

// ---------------------------------------------------------------------------
// Mock ComponentDef helpers
// ---------------------------------------------------------------------------

function mockDef(id: string, targetDir: string): { def: ComponentDef; targetDir: string; fileCount: number } {
  return {
    def: {
      id,
      label: id,
      description: `mock ${id}`,
      sourcePath: id,
      target: () => targetDir,
      alwaysGlobal: false,
    },
    targetDir,
    fileCount: 10,
  };
}

// ---------------------------------------------------------------------------
// resolveParentDir
// ---------------------------------------------------------------------------
describe('BlueprintPreview.logic', () => {
  describe('resolveParentDir', () => {
    it('extracts ~/.maestro parent from full path', () => {
      // Unix-style path
      const result = resolveParentDir('/home/user/.maestro/workflows');
      assert.equal(result, '/home/user/.maestro');
    });

    it('extracts ~/.claude parent from full path', () => {
      const result = resolveParentDir('/home/user/.claude/commands');
      assert.equal(result, '/home/user/.claude');
    });

    it('extracts ~/.codex parent from full path', () => {
      const result = resolveParentDir('/home/user/.codex/skills');
      assert.equal(result, '/home/user/.codex');
    });

    it('handles Windows-style paths by normalizing slashes', () => {
      const result = resolveParentDir('C:/Users/dev/.maestro/templates');
      assert.equal(result, 'C:/Users/dev/.maestro');
    });

    it('handles nested path with overlays', () => {
      const result = resolveParentDir('/home/user/.maestro/overlays/_shipped');
      assert.equal(result, '/home/user/.maestro');
    });

    it('defaults to first two segments when no special dir found', () => {
      const result = resolveParentDir('/some/random/path');
      assert.equal(result, '/some');
    });
  });

  // ---------------------------------------------------------------------------
  // resolveSubPath
  // ---------------------------------------------------------------------------
  describe('resolveSubPath', () => {
    it('extracts sub-path after parent dir', () => {
      const result = resolveSubPath('/home/user/.maestro/workflows');
      assert.equal(result, 'workflows');
    });

    it('extracts nested sub-path', () => {
      const result = resolveSubPath('/home/user/.maestro/overlays/_shipped');
      assert.equal(result, 'overlays/_shipped');
    });

    it('returns dot when target is the parent itself', () => {
      const result = resolveSubPath('/home/user/.claude/CLAUDE.md');
      // CLAUDE.md is a file, sub-path is "CLAUDE.md"
      assert.equal(result, 'CLAUDE.md');
    });
  });

  // ---------------------------------------------------------------------------
  // buildTree
  // ---------------------------------------------------------------------------
  describe('buildTree', () => {
    it('groups components by parent directory', () => {
      const inputs = [
        mockDef('workflows', '/home/user/.maestro/workflows'),
        mockDef('templates', '/home/user/.maestro/templates'),
        mockDef('commands', '/home/user/.claude/commands'),
      ];

      const tree = buildTree(inputs);
      assert.equal(tree.length, 2);

      // First group: .maestro
      assert.equal(tree[0].parentDir, '/home/user/.maestro');
      assert.equal(tree[0].entries.length, 2);
      assert.equal(tree[0].totalFiles, 20);
      assert.equal(tree[0].entries[0].subPath, 'workflows');
      assert.equal(tree[0].entries[1].subPath, 'templates');

      // Second group: .claude
      assert.equal(tree[1].parentDir, '/home/user/.claude');
      assert.equal(tree[1].entries.length, 1);
      assert.equal(tree[1].totalFiles, 10);
    });

    it('returns empty array for no components', () => {
      const tree = buildTree([]);
      assert.equal(tree.length, 0);
    });

    it('handles single component', () => {
      const inputs = [
        mockDef('workflows', '/home/user/.maestro/workflows'),
      ];
      const tree = buildTree(inputs);
      assert.equal(tree.length, 1);
      assert.equal(tree[0].parentDir, '/home/user/.maestro');
      assert.equal(tree[0].entries[0].subPath, 'workflows');
      assert.equal(tree[0].entries[0].fileCount, 10);
    });

    it('groups all 9 components correctly by parent', () => {
      const inputs = [
        mockDef('workflows', '/home/user/.maestro/workflows'),
        mockDef('templates', '/home/user/.maestro/templates'),
        mockDef('chains', '/home/user/.maestro/chains'),
        mockDef('overlays', '/maestro/overlays/_shipped'),
        mockDef('commands', '/home/user/.claude/commands'),
        mockDef('agents', '/home/user/.claude/agents'),
        mockDef('skills', '/home/user/.claude/skills'),
        mockDef('claude-md', '/home/user/.claude/CLAUDE.md'),
        mockDef('codex-skills', '/home/user/.codex/skills'),
      ];

      const tree = buildTree(inputs);
      // Should group into: .maestro, .claude, .codex
      const parentDirs = tree.map((g) => g.parentDir);
      assert.ok(parentDirs.includes('/home/user/.maestro'));
      assert.ok(parentDirs.includes('/home/user/.claude'));
      assert.ok(parentDirs.includes('/home/user/.codex'));
    });

    it('handles Windows-style backslash paths', () => {
      const inputs = [
        mockDef('workflows', 'C:\\Users\\dev\\.maestro\\workflows'),
        mockDef('commands', 'C:\\Users\\dev\\.claude\\commands'),
      ];

      const tree = buildTree(inputs);
      assert.equal(tree.length, 2);
      assert.equal(tree[0].parentDir, 'C:/Users/dev/.maestro');
      assert.equal(tree[1].parentDir, 'C:/Users/dev/.claude');
    });

    it('accumulates file counts per group', () => {
      const inputs = [
        { ...mockDef('workflows', '/home/user/.maestro/workflows'), fileCount: 32 },
        { ...mockDef('templates', '/home/user/.maestro/templates'), fileCount: 12 },
      ];

      const tree = buildTree(inputs);
      assert.equal(tree.length, 1);
      assert.equal(tree[0].totalFiles, 44);
    });
  });
});

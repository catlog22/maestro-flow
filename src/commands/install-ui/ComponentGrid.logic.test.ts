import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toggleSelection,
  selectAllAvailable,
  deselectAll,
  moveUp,
  moveDown,
  parseNumberKey,
  clampIndex,
} from './ComponentGrid.logic.js';

describe('ComponentGrid.logic', () => {
  // ---------------------------------------------------------------------------
  // toggleSelection
  // ---------------------------------------------------------------------------
  describe('toggleSelection', () => {
    it('adds an id when not present', () => {
      const result = toggleSelection(['a', 'b'], 'c');
      assert.deepEqual(result, ['a', 'b', 'c']);
    });

    it('removes an id when already present', () => {
      const result = toggleSelection(['a', 'b', 'c'], 'b');
      assert.deepEqual(result, ['a', 'c']);
    });

    it('toggles in empty list', () => {
      const result = toggleSelection([], 'x');
      assert.deepEqual(result, ['x']);
    });

    it('does not mutate the original array', () => {
      const original = ['a', 'b'];
      toggleSelection(original, 'c');
      assert.deepEqual(original, ['a', 'b']);
    });
  });

  // ---------------------------------------------------------------------------
  // selectAllAvailable / deselectAll
  // ---------------------------------------------------------------------------
  describe('selectAllAvailable', () => {
    it('returns copy of available ids', () => {
      const ids = ['workflows', 'templates', 'chains'];
      const result = selectAllAvailable(ids);
      assert.deepEqual(result, ['workflows', 'templates', 'chains']);
      // Verify it's a copy
      result.push('extra');
      assert.equal(ids.length, 3);
    });
  });

  describe('deselectAll', () => {
    it('returns empty array', () => {
      assert.deepEqual(deselectAll(), []);
    });
  });

  // ---------------------------------------------------------------------------
  // moveUp / moveDown — wrapping navigation
  // ---------------------------------------------------------------------------
  describe('moveUp', () => {
    it('moves from index 2 to 1 with 5 items', () => {
      assert.equal(moveUp(2, 5), 1);
    });

    it('wraps from index 0 to last index', () => {
      assert.equal(moveUp(0, 5), 4);
    });

    it('handles minimum 2 items', () => {
      assert.equal(moveUp(0, 2), 1);
      assert.equal(moveUp(1, 2), 0);
    });

    it('handles single item', () => {
      assert.equal(moveUp(0, 1), 0);
    });

    it('handles zero items', () => {
      assert.equal(moveUp(0, 0), 0);
    });
  });

  describe('moveDown', () => {
    it('moves from index 1 to 2 with 5 items', () => {
      assert.equal(moveDown(1, 5), 2);
    });

    it('wraps from last index to 0', () => {
      assert.equal(moveDown(4, 5), 0);
    });

    it('handles minimum 2 items', () => {
      assert.equal(moveDown(0, 2), 1);
      assert.equal(moveDown(1, 2), 0);
    });

    it('handles single item', () => {
      assert.equal(moveDown(0, 1), 0);
    });

    it('handles zero items', () => {
      assert.equal(moveDown(0, 0), 0);
    });
  });

  // ---------------------------------------------------------------------------
  // parseNumberKey — mapping '1'-'9' to 0-based index
  // ---------------------------------------------------------------------------
  describe('parseNumberKey', () => {
    it('maps "1" to index 0 with 9 components', () => {
      assert.equal(parseNumberKey('1', 9), 0);
    });

    it('maps "9" to index 8 with 9 components', () => {
      assert.equal(parseNumberKey('9', 9), 8);
    });

    it('returns -1 for "0"', () => {
      assert.equal(parseNumberKey('0', 9), -1);
    });

    it('returns -1 for non-numeric input', () => {
      assert.equal(parseNumberKey('a', 9), -1);
    });

    it('returns -1 when number exceeds component count', () => {
      // Only 5 components, pressing '6' should be invalid
      assert.equal(parseNumberKey('6', 5), -1);
    });

    it('supports exactly 9 components (max)', () => {
      assert.equal(parseNumberKey('9', 9), 8);
    });

    it('supports exactly 2 components (min meaningful)', () => {
      assert.equal(parseNumberKey('1', 2), 0);
      assert.equal(parseNumberKey('2', 2), 1);
      assert.equal(parseNumberKey('3', 2), -1);
    });

    it('returns -1 for single component pressing "2"', () => {
      assert.equal(parseNumberKey('2', 1), -1);
    });
  });

  // ---------------------------------------------------------------------------
  // clampIndex
  // ---------------------------------------------------------------------------
  describe('clampIndex', () => {
    it('returns 0 for empty list', () => {
      assert.equal(clampIndex(5, 0), 0);
    });

    it('returns last valid index when over', () => {
      assert.equal(clampIndex(10, 5), 4);
    });

    it('returns index unchanged when valid', () => {
      assert.equal(clampIndex(2, 5), 2);
    });

    it('returns 0 for index 0 with any count', () => {
      assert.equal(clampIndex(0, 3), 0);
    });
  });

  // ---------------------------------------------------------------------------
  // Integration scenarios
  // ---------------------------------------------------------------------------
  describe('navigation + toggling scenario', () => {
    const ids = ['workflows', 'templates', 'chains', 'overlays', 'commands',
                 'agents', 'skills', 'claude-md', 'codex-agents-md',
                 'codex-agents', 'codex-skills'];

    it('simulates full navigation cycle with 11 items', () => {
      let idx = 0;
      // Move down through all 11 items and wrap back to 0
      for (let i = 0; i < 11; i++) {
        idx = moveDown(idx, 11);
      }
      assert.equal(idx, 0);
    });

    it('simulates full navigation cycle up with 11 items', () => {
      let idx = 10;
      // Move up through all 11 items and wrap back to 10
      for (let i = 0; i < 11; i++) {
        idx = moveUp(idx, 11);
      }
      assert.equal(idx, 10);
    });

    it('toggles selection state consistently', () => {
      let selected: string[] = [];
      // Toggle item 3 on
      selected = toggleSelection(selected, ids[2]);
      assert.deepEqual(selected, [ids[2]]);
      // Toggle item 5 on
      selected = toggleSelection(selected, ids[4]);
      assert.deepEqual(selected, [ids[2], ids[4]]);
      // Toggle item 3 off
      selected = toggleSelection(selected, ids[2]);
      assert.deepEqual(selected, [ids[4]]);
      // Select all
      selected = selectAllAvailable(ids);
      assert.equal(selected.length, 11);
      // Deselect all
      selected = deselectAll();
      assert.equal(selected.length, 0);
    });

    it('number keys cover first 9 of 11 components', () => {
      // parseNumberKey only supports keys 1-9, so 11 components means keys 0-9 cover indices 0-8
      for (let i = 1; i <= 9; i++) {
        const idx = parseNumberKey(String(i), 11);
        assert.equal(idx, i - 1, `Key '${i}' should map to index ${i - 1}`);
      }
    });

    it('minimum 2 items: number keys 1 and 2 work', () => {
      assert.equal(parseNumberKey('1', 2), 0);
      assert.equal(parseNumberKey('2', 2), 1);
      assert.equal(parseNumberKey('3', 2), -1);
    });
  });
});

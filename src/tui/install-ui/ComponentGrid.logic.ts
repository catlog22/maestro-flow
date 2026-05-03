// ---------------------------------------------------------------------------
// Pure selection logic extracted from ComponentGrid for testability.
// ComponentGrid re-exports these for its own use.
// ---------------------------------------------------------------------------

/**
 * Toggle a single ID in the current selection array.
 * Returns a new array (immutable).
 */
export function toggleSelection(currentIds: string[], id: string): string[] {
  return currentIds.includes(id)
    ? currentIds.filter((x) => x !== id)
    : [...currentIds, id];
}

/**
 * Select all available component IDs.
 */
export function selectAllAvailable(availableIds: string[]): string[] {
  return [...availableIds];
}

/**
 * Deselect all.
 */
export function deselectAll(): string[] {
  return [];
}

/**
 * Move the highlight index up with wrapping.
 */
export function moveUp(currentIndex: number, count: number): number {
  if (count === 0) return 0;
  return currentIndex <= 0 ? count - 1 : currentIndex - 1;
}

/**
 * Move the highlight index down with wrapping.
 */
export function moveDown(currentIndex: number, count: number): number {
  if (count === 0) return 0;
  return currentIndex >= count - 1 ? 0 : currentIndex + 1;
}

/**
 * Parse a number key input ('1'-'9') into a 0-based index.
 * Returns -1 if not a valid number key for the given component count.
 */
export function parseNumberKey(input: string, count: number): number {
  const num = parseInt(input, 10);
  if (isNaN(num) || num < 1 || num > 9 || num > count) return -1;
  return num - 1;
}

/**
 * Clamp an index to valid range [0, max(count-1, 0)].
 */
export function clampIndex(index: number, count: number): number {
  return Math.min(index, Math.max(0, count - 1));
}

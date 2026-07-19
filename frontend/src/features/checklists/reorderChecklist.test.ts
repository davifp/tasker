import { describe, it, expect } from 'vitest';
import type { ChecklistItem } from '@/lib/http/types';
import { computeReorderPosition } from './reorderChecklist';

function makeItem(id: string, position: string): ChecklistItem {
  return {
    id,
    taskId: 't-1',
    title: `Item ${id}`,
    checked: false,
    position,
    createdAt: '2026-07-19T00:00:00Z',
  };
}

// Regression tests for BUG-08.M4 — the checklist reorder UI was never
// wired. This helper is the compute step that translates a dnd-kit
// (active, over) pair into the fractional-indexing position the reorder
// mutation posts to the server.
describe('computeReorderPosition — BUG-08.M4 regression', () => {
  const items = [makeItem('a', 'a0'), makeItem('b', 'a1'), makeItem('c', 'a2')];

  it('moves a middle row up above the head', () => {
    // Drag "b" over "a" → new position must sort BEFORE "a0".
    const pos = computeReorderPosition(items, 'b', 'a');
    expect(pos).not.toBeNull();
    expect(pos! < 'a0').toBe(true);
  });

  it('moves the head row down between second and third', () => {
    // Drag "a" over "c" → target neighbors (b, c) with b at 'a1' and c at 'a2'.
    const pos = computeReorderPosition(items, 'a', 'c');
    expect(pos).not.toBeNull();
    expect('a1' < pos!).toBe(true);
    expect(pos! < 'a2').toBe(true);
  });

  it('moves the tail row up above the head', () => {
    const pos = computeReorderPosition(items, 'c', 'a');
    expect(pos).not.toBeNull();
    expect(pos! < 'a0').toBe(true);
  });

  it('returns null for a no-op drag (activeId === overId)', () => {
    expect(computeReorderPosition(items, 'b', 'b')).toBeNull();
  });

  it('returns null when the active id does not exist (stale event)', () => {
    expect(computeReorderPosition(items, 'ghost', 'a')).toBeNull();
  });

  it('returns null when the over id does not exist', () => {
    expect(computeReorderPosition(items, 'a', 'ghost')).toBeNull();
  });

  it('handles a two-item list correctly', () => {
    const pair = [makeItem('a', 'a0'), makeItem('b', 'a1')];
    const pos = computeReorderPosition(pair, 'b', 'a');
    expect(pos).not.toBeNull();
    expect(pos! < 'a0').toBe(true);
  });
});

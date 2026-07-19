import { Positions } from '@/lib/ordering/positions';
import type { ChecklistItem } from '@/lib/http/types';

// Given the current ordered items and a dnd-kit (activeId, overId) pair,
// return the fractional-indexing position key the reorder mutation should
// send to the server. Splitting this out of `ChecklistPanel` so the math
// is unit-testable in isolation — the panel only owns the DOM wiring.
//
// Returns null when the drag is a no-op (same slot, unknown items,
// neighbors equal) — the caller should skip the mutate call.
export function computeReorderPosition(
  items: readonly ChecklistItem[],
  activeId: string,
  overId: string,
): string | null {
  if (activeId === overId) return null;
  const dragged = items.find((item) => item.id === activeId);
  if (!dragged) return null;
  const others = items.filter((item) => item.id !== activeId);
  const targetIndex = others.findIndex((item) => item.id === overId);
  if (targetIndex < 0) return null;
  const before = targetIndex > 0 ? (others[targetIndex - 1]?.position ?? null) : null;
  const after = others[targetIndex]?.position ?? null;
  try {
    return Positions.between(before, after);
  } catch {
    return null;
  }
}

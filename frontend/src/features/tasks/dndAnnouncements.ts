import type { Announcements } from '@dnd-kit/core';

interface Callbacks {
  onDragStart: (id: string) => string;
  onDragOver: (id: string, over: string) => string;
  onDragEnd: (id: string, over: string) => string;
  onDragCancel: (id: string) => string;
}

// Localized replacement for dnd-kit's default English announcements. The
// board wires this via `<DndContext accessibility={{ announcements }} />`
// so screen-reader users hear pt-BR narration when the workspace locale
// is `pt-BR`.
export function boardDndAnnouncements(cb: Callbacks): Announcements {
  return {
    onDragStart({ active }) {
      return cb.onDragStart(String(active.id));
    },
    onDragOver({ active, over }) {
      if (!over) return undefined;
      return cb.onDragOver(String(active.id), String(over.id));
    },
    onDragEnd({ active, over }) {
      if (!over) return cb.onDragCancel(String(active.id));
      return cb.onDragEnd(String(active.id), String(over.id));
    },
    onDragCancel({ active }) {
      return cb.onDragCancel(String(active.id));
    },
  };
}

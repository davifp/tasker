'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SearchEntityType } from '@tasker/config';

export interface RecentItem {
  type: SearchEntityType | 'route';
  id: string;
  label: string;
  url: string;
  workspaceSlug: string;
  visitedAt: number;
}

const STORAGE_KEY = 'tasker:recent-items';
const CAP = 8;

function load(): RecentItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentItem);
  } catch {
    return [];
  }
}

function save(items: RecentItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Quota exceeded / storage disabled — silently drop.
  }
}

function isRecentItem(value: unknown): value is RecentItem {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.type === 'string' &&
    typeof v.id === 'string' &&
    typeof v.label === 'string' &&
    typeof v.url === 'string' &&
    typeof v.workspaceSlug === 'string' &&
    typeof v.visitedAt === 'number'
  );
}

/**
 * Manages the "Recently visited" list surfaced by the ⌘K palette when no
 * query is typed. Client-only (localStorage), capped at 8 entries per
 * workspace, deduplicated by url.
 */
export function useRecentItems(workspaceSlug: string): {
  items: RecentItem[];
  push: (item: Omit<RecentItem, 'visitedAt' | 'workspaceSlug'>) => void;
  clear: () => void;
} {
  const [items, setItems] = useState<RecentItem[]>([]);

  useEffect(() => {
    setItems(
      load()
        .filter((it) => it.workspaceSlug === workspaceSlug)
        .slice(0, CAP),
    );
  }, [workspaceSlug]);

  const push = useCallback<ReturnType<typeof useRecentItems>['push']>(
    (item) => {
      const all = load();
      const next: RecentItem = { ...item, workspaceSlug, visitedAt: Date.now() };
      // Dedupe by url within this workspace, then prepend, cap globally to keep
      // storage size bounded even across many workspaces.
      const filtered = all.filter(
        (it) => !(it.workspaceSlug === workspaceSlug && it.url === next.url),
      );
      const combined = [next, ...filtered].slice(0, CAP * 4);
      save(combined);
      setItems(combined.filter((it) => it.workspaceSlug === workspaceSlug).slice(0, CAP));
    },
    [workspaceSlug],
  );

  const clear = useCallback(() => {
    const all = load();
    const remaining = all.filter((it) => it.workspaceSlug !== workspaceSlug);
    save(remaining);
    setItems([]);
  }, [workspaceSlug]);

  return { items, push, clear };
}

'use client';

import { useCallback, useEffect, useState } from 'react';

// SSR-safe per-project ephemeral slice. Density, expanded/collapsed
// panels, and other device-local bits live here. Never round-trips to
// the server — durable prefs live in useViewPreferences instead.

export interface EphemeralViewPreferences {
  density?: 'compact' | 'comfortable';
  expandedPanels?: Record<string, boolean>;
}

const STORAGE_PREFIX = 'tasker:viewPrefs:';

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`;
}

function read(projectId: string): EphemeralViewPreferences {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as EphemeralViewPreferences;
    }
    return {};
  } catch {
    return {};
  }
}

function write(projectId: string, value: EphemeralViewPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(value));
  } catch {
    // localStorage may be blocked (private mode, quota). Silent — the
    // in-memory state still reflects the change until reload.
  }
}

interface UseEphemeralViewPreferencesResult {
  preferences: EphemeralViewPreferences;
  set(patch: EphemeralViewPreferences): void;
}

export function useEphemeralViewPreferences(
  projectId: string,
): UseEphemeralViewPreferencesResult {
  // Start empty on the server so hydration matches; the first client
  // effect swaps in the persisted slice.
  const [preferences, setPreferences] = useState<EphemeralViewPreferences>({});

  useEffect(() => {
    setPreferences(read(projectId));
  }, [projectId]);

  const set = useCallback(
    (patch: EphemeralViewPreferences) => {
      setPreferences((prev) => {
        const merged = { ...prev, ...patch };
        write(projectId, merged);
        return merged;
      });
    },
    [projectId],
  );

  return { preferences, set };
}

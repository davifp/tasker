'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  viewPreferencesHttp,
  type ViewPreferences,
} from '@/lib/http/viewPreferences';

// Debounce window for durable writes. Multiple rapid `.set()` calls
// coalesce into a single PUT so a burst of column toggles or a
// slider drag doesn't chatter the server.
const WRITE_DEBOUNCE_MS = 300;

const viewPreferencesKeys = {
  detail: (workspaceSlug: string, projectSlug: string) =>
    ['view-preferences', workspaceSlug, projectSlug] as const,
};

const EMPTY: ViewPreferences = {};

interface UseViewPreferencesResult {
  preferences: ViewPreferences;
  isLoading: boolean;
  isError: boolean;
  set(patch: ViewPreferences): void;
}

/**
 * Hydrates durable per-(user, project) preferences from the backend and
 * exposes a debounced writer. Writes are optimistic — the query cache
 * updates immediately, then the PUT fires after {@link WRITE_DEBOUNCE_MS}
 * of quiet time. Rapid successive calls stack into a single merged
 * payload. On server error the cache reverts to the last known-good
 * snapshot and a toast surfaces.
 */
export function useViewPreferences(
  workspaceSlug: string,
  projectSlug: string,
): UseViewPreferencesResult {
  const queryClient = useQueryClient();
  const t = useTranslations('viewPreferences');
  // Memoize the query key so downstream `useCallback`s that depend on
  // it don't tear their identity every render — a new tuple each time
  // would defeat the debounce timer's stable-callback intent.
  const key = useMemo(
    () => viewPreferencesKeys.detail(workspaceSlug, projectSlug),
    [workspaceSlug, projectSlug],
  );

  const query = useQuery({
    queryKey: key,
    queryFn: () => viewPreferencesHttp.get(workspaceSlug, projectSlug),
    enabled: Boolean(workspaceSlug && projectSlug),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (query.isError) toast.error(t('errorLoad'));
  }, [query.isError, t]);

  interface MutationVars {
    patch: ViewPreferences;
    // Snapshot captured at the FIRST `.set()` in the debounce burst, so
    // `onError` can revert past the optimistic writes that already
    // touched the cache.
    snapshot: ViewPreferences | undefined;
  }

  const mutation = useMutation<ViewPreferences, unknown, MutationVars>({
    mutationFn: ({ patch }) =>
      viewPreferencesHttp.update(workspaceSlug, projectSlug, patch),
    async onMutate() {
      await queryClient.cancelQueries({ queryKey: key });
    },
    onError(_err, vars) {
      // `setQueryData(key, undefined)` is a no-op in TanStack Query v5 —
      // when the pre-optimistic snapshot was empty (fresh account, no
      // GET data yet), reverting requires the explicit empty payload
      // so the optimistic write is actually overwritten.
      queryClient.setQueryData<ViewPreferences>(key, vars.snapshot ?? EMPTY);
      toast.error(t('errorSave'));
    },
    onSuccess(server) {
      // Server payload wins after the round-trip — it's the shallow-
      // merged truth and may differ from the local optimistic guess if
      // a peer tab wrote concurrently.
      queryClient.setQueryData<ViewPreferences>(key, server);
    },
  });

  // Debounce state kept in refs so the closure never restarts and each
  // `.set()` cancels the pending timer before scheduling a fresh one.
  const pendingRef = useRef<ViewPreferences>({});
  const snapshotRef = useRef<ViewPreferences | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutateRef = useRef(mutation.mutate);
  mutateRef.current = mutation.mutate;

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const set = useCallback(
    (patch: ViewPreferences) => {
      // Snapshot once per debounce burst — first `.set()` after the
      // timer clears captures the pre-optimistic state so a failed PUT
      // can roll back to reality, not to the previous optimistic value.
      if (timerRef.current === null) {
        snapshotRef.current = queryClient.getQueryData<ViewPreferences>(key);
      }
      pendingRef.current = { ...pendingRef.current, ...patch };
      // Optimistic cache write happens immediately so the UI reflects
      // the change before the debounced PUT fires.
      const current = queryClient.getQueryData<ViewPreferences>(key) ?? EMPTY;
      queryClient.setQueryData<ViewPreferences>(key, { ...current, ...patch });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const coalesced = pendingRef.current;
        const snapshot = snapshotRef.current;
        pendingRef.current = {};
        snapshotRef.current = undefined;
        timerRef.current = null;
        mutateRef.current({ patch: coalesced, snapshot });
      }, WRITE_DEBOUNCE_MS);
    },
    [key, queryClient],
  );

  return {
    preferences: query.data ?? EMPTY,
    isLoading: query.isLoading,
    isError: query.isError,
    set,
  };
}

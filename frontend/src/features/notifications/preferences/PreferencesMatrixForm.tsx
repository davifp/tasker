'use client';

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePreferences, useUpdatePreferences } from '../hooks/useNotifications';
import type {
  NotificationChannel,
  NotificationEventType,
  PreferencesResponse,
} from '@/lib/http/notifications';

const EVENT_TYPES: NotificationEventType[] = [
  'COMMENT_MENTION',
  'TASK_ASSIGNED',
  'COMMENT_FOLLOWED',
  'SPRINT_LIFECYCLE',
];
const CHANNELS: NotificationChannel[] = ['IN_APP', 'EMAIL', 'PUSH'];

// The form binds a single boolean per (event × channel) cell, keyed by a
// combined string so React Hook Form can register each checkbox with a
// unique name and Zod can validate the flat shape trivially.
const cellKey = (eventType: NotificationEventType, channel: NotificationChannel) =>
  `${eventType}:${channel}` as const;
type CellKey = ReturnType<typeof cellKey>;

const matrixSchema = z.record(z.string(), z.boolean());
type MatrixForm = Record<CellKey, boolean>;

function toDefaults(response: PreferencesResponse | undefined): MatrixForm {
  const defaults: Partial<Record<CellKey, boolean>> = {};
  for (const eventType of EVENT_TYPES) {
    for (const channel of CHANNELS) defaults[cellKey(eventType, channel)] = false;
  }
  if (response) {
    for (const item of response.items) {
      defaults[cellKey(item.eventType, item.channel)] = item.enabled;
    }
  }
  return defaults as MatrixForm;
}

export function PreferencesMatrixForm() {
  const t = useTranslations('notifications');
  const query = usePreferences();
  const mutation = useUpdatePreferences();

  const defaults = useMemo(() => toDefaults(query.data), [query.data]);
  const form = useForm<MatrixForm>({
    resolver: zodResolver(matrixSchema),
    defaultValues: defaults,
    values: defaults,
  });

  // `values` above keeps the form in sync when the query resolves after mount.
  useEffect(() => {
    if (query.data) form.reset(defaults);
  }, [defaults, form, query.data]);

  async function onSubmit(values: MatrixForm) {
    const preferences = EVENT_TYPES.flatMap((eventType) =>
      CHANNELS.map((channel) => ({
        eventType,
        channel,
        enabled: Boolean(values[cellKey(eventType, channel)]),
      })),
    );
    try {
      await mutation.mutateAsync({ preferences });
      toast.success(t('preferences.saved'));
    } catch {
      toast.error(t('preferences.error'));
    }
  }

  if (query.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                {t('preferences.columns.event')}
              </th>
              {CHANNELS.map((channel) => (
                <th key={channel} scope="col" className="px-3 py-2 font-medium">
                  {t(`channel.${channel}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {EVENT_TYPES.map((eventType) => (
              <tr key={eventType} className="border-t border-border">
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  {t(`event.${eventType}`)}
                </th>
                {CHANNELS.map((channel) => {
                  const key = cellKey(eventType, channel);
                  const inputId = `pref-${key}`;
                  return (
                    <td key={channel} className="px-3 py-2">
                      <input
                        id={inputId}
                        type="checkbox"
                        className="h-4 w-4 rounded border-border"
                        aria-label={`${t(`event.${eventType}`)} — ${t(`channel.${channel}`)}`}
                        {...form.register(key)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={mutation.isPending || form.formState.isSubmitting}>
          {t('preferences.save')}
        </Button>
      </div>
    </form>
  );
}

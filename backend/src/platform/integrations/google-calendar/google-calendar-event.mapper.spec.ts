import { describe, expect, it } from 'vitest';
import {
  buildSprintUid,
  buildTaskUid,
  mapSprintToEvent,
  mapTaskToEvent,
} from './google-calendar-event.mapper';

describe('mapTaskToEvent', () => {
  const base = {
    workspaceId: 'ws_1',
    taskId: 'tk_1',
    taskNumber: 42,
    projectSlug: 'wht',
    title: 'Ship the thing',
    status: 'IN_PROGRESS',
  };

  it('returns null when neither startDate nor dueDate is set', () => {
    expect(mapTaskToEvent(base)).toBeNull();
  });

  it('summary follows [projectSlug#N] Title convention', () => {
    const event = mapTaskToEvent({ ...base, dueDate: '2026-08-05T00:00:00.000Z' });
    expect(event?.summary).toBe('[wht#42] Ship the thing');
  });

  it('uses the stable iCalUID keyed on (task, workspace) so upserts dedupe', () => {
    const a = mapTaskToEvent({ ...base, dueDate: '2026-08-05T00:00:00.000Z' });
    const b = mapTaskToEvent({ ...base, dueDate: '2026-09-01T00:00:00.000Z' });
    expect(a?.iCalUID).toBe(b?.iCalUID);
    expect(a?.iCalUID).toBe(buildTaskUid('ws_1', 'tk_1'));
  });

  it('midnight-UTC timestamps become all-day events (date field) with exclusive end', () => {
    const event = mapTaskToEvent({ ...base, dueDate: '2026-08-05T00:00:00.000Z' });
    expect(event?.start).toEqual({ date: '2026-08-05' });
    expect(event?.end).toEqual({ date: '2026-08-06' });
  });

  it('non-midnight timestamps become scoped events with timeZone UTC', () => {
    const event = mapTaskToEvent({ ...base, dueDate: '2026-08-05T14:30:00.000Z' });
    expect(event?.start).toEqual({ dateTime: '2026-08-05T14:30:00.000Z', timeZone: 'UTC' });
    expect(event?.end).toEqual({ dateTime: '2026-08-05T14:30:00.000Z', timeZone: 'UTC' });
  });

  it('start+due range: end date bumped by one day per Google all-day convention', () => {
    const event = mapTaskToEvent({
      ...base,
      startDate: '2026-08-05T00:00:00.000Z',
      dueDate: '2026-08-07T00:00:00.000Z',
    });
    expect(event?.start).toEqual({ date: '2026-08-05' });
    expect(event?.end).toEqual({ date: '2026-08-08' });
  });

  it('includes description when set, omits it when null', () => {
    const withDesc = mapTaskToEvent({
      ...base,
      dueDate: '2026-08-05T00:00:00.000Z',
      description: 'Do the thing carefully',
    });
    expect(withDesc?.description).toBe('Do the thing carefully');
    const withoutDesc = mapTaskToEvent({ ...base, dueDate: '2026-08-05T00:00:00.000Z' });
    expect(withoutDesc?.description).toBeUndefined();
  });
});

describe('mapSprintToEvent', () => {
  const sprint = {
    workspaceId: 'ws_1',
    sprintId: 'sp_1',
    name: 'S24-08',
    startDate: '2026-08-01T00:00:00.000Z',
    endDate: '2026-08-14T00:00:00.000Z',
  };

  it('emits an all-day event spanning start..end+1 (exclusive)', () => {
    const event = mapSprintToEvent(sprint);
    expect(event.summary).toBe('[Sprint] S24-08');
    expect(event.start).toEqual({ date: '2026-08-01' });
    expect(event.end).toEqual({ date: '2026-08-15' });
  });

  it('uses stable UID keyed on (sprint, workspace)', () => {
    const event = mapSprintToEvent(sprint);
    expect(event.iCalUID).toBe(buildSprintUid('ws_1', 'sp_1'));
  });
});

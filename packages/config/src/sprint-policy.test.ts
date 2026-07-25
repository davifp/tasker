import { describe, it, expect } from 'vitest';
import {
  SPRINT_MAX_ACTIVE_PER_PROJECT,
  SPRINT_MAX_DAYS_DEFAULT,
  SPRINT_MIN_DAYS,
  SPRINT_SNAPSHOT_PHASES,
  SPRINT_STATES,
  SprintPolicy,
  isSprintState,
} from './sprint-policy';

describe('SprintPolicy', () => {
  it('enforces at most one Active sprint per project (PRD FR-2)', () => {
    expect(SPRINT_MAX_ACTIVE_PER_PROJECT).toBe(1);
  });

  it('defines lifecycle states in PLANNED → ACTIVE → COMPLETED order', () => {
    expect(SPRINT_STATES).toEqual(['PLANNED', 'ACTIVE', 'COMPLETED']);
  });

  it('defines snapshot phases matching the sprint boundaries', () => {
    expect(SPRINT_SNAPSHOT_PHASES).toEqual(['START', 'COMPLETE']);
  });

  it('keeps min days at 1 and max days at a monthly upper bound', () => {
    expect(SPRINT_MIN_DAYS).toBe(1);
    expect(SPRINT_MAX_DAYS_DEFAULT).toBeGreaterThanOrEqual(14);
    expect(SPRINT_MAX_DAYS_DEFAULT).toBeLessThanOrEqual(62);
  });

  it('exposes a frozen bundled snapshot', () => {
    expect(Object.isFrozen(SprintPolicy)).toBe(true);
  });
});

describe('isSprintState', () => {
  it('accepts every documented state', () => {
    for (const s of SPRINT_STATES) {
      expect(isSprintState(s)).toBe(true);
    }
  });

  it('rejects unknown values', () => {
    expect(isSprintState('planned')).toBe(false); // case sensitive
    expect(isSprintState('CANCELLED')).toBe(false);
    expect(isSprintState(null)).toBe(false);
    expect(isSprintState(1)).toBe(false);
  });
});

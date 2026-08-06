import { describe, expect, it } from 'vitest';
import { shouldRejectAsDemo, WRITE_OPS } from './demo-readonly.extension';

const READS = ['findFirst', 'findMany', 'findUnique', 'count', 'aggregate'];

describe('shouldRejectAsDemo', () => {
  it('lets every read op through regardless of role', () => {
    for (const op of READS) {
      expect(shouldRejectAsDemo(op, 'DEMO_VIEWER')).toBe(false);
      expect(shouldRejectAsDemo(op, 'MEMBER')).toBe(false);
      expect(shouldRejectAsDemo(op, undefined)).toBe(false);
    }
  });

  it('lets every write op through for non-demo roles', () => {
    for (const op of WRITE_OPS) {
      for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'GUEST']) {
        expect(shouldRejectAsDemo(op, role)).toBe(false);
      }
    }
  });

  it('rejects every write op for DEMO_VIEWER', () => {
    for (const op of WRITE_OPS) {
      expect(shouldRejectAsDemo(op, 'DEMO_VIEWER')).toBe(true);
    }
  });

  it('lets writes through when no context is active (system paths, seed, etc.)', () => {
    for (const op of WRITE_OPS) {
      expect(shouldRejectAsDemo(op, undefined)).toBe(false);
    }
  });
});

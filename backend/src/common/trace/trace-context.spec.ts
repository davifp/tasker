import { describe, it, expect } from 'vitest';
import { TraceContext } from './trace-context';

describe('TraceContext', () => {
  it('returns the traceId inside a run callback', () => {
    let captured: string | undefined;
    TraceContext.run('test-id', () => {
      captured = TraceContext.get();
    });
    expect(captured).toBe('test-id');
  });

  it('returns undefined outside a run callback', () => {
    expect(TraceContext.get()).toBeUndefined();
  });

  it('isolates traceId across concurrent runs', async () => {
    const results: string[] = [];
    await Promise.all([
      new Promise<void>((resolve) =>
        TraceContext.run('id-a', () => {
          setTimeout(() => {
            results.push(TraceContext.get() ?? 'none');
            resolve();
          }, 10);
        }),
      ),
      new Promise<void>((resolve) =>
        TraceContext.run('id-b', () => {
          setTimeout(() => {
            results.push(TraceContext.get() ?? 'none');
            resolve();
          }, 5);
        }),
      ),
    ]);
    expect(results).toContain('id-a');
    expect(results).toContain('id-b');
  });
});

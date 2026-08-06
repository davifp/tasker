import { describe, expect, it } from 'vitest';
import { listAdrs, readAdr } from './adr-catalog';

describe('adr-catalog', () => {
  it('lists at least one ADR with a title and status', async () => {
    const adrs = await listAdrs();
    expect(adrs.length).toBeGreaterThan(0);
    for (const adr of adrs) {
      expect(adr.title).toBeTruthy();
      expect(adr.status).toBeTruthy();
      expect(adr.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('reads a known ADR by slug', async () => {
    const doc = await readAdr('0004-simulated-incident');
    expect(doc).not.toBeNull();
    expect(doc?.markdown).toContain('Simulated incident');
  });

  it('rejects directory traversal in the slug', async () => {
    const doc = await readAdr('../../etc/passwd');
    expect(doc).toBeNull();
  });

  it('returns null for unknown slugs', async () => {
    const doc = await readAdr('does-not-exist');
    expect(doc).toBeNull();
  });
});

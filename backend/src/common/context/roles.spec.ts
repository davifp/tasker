import { describe, it, expect } from 'vitest';
import { satisfiesRole } from './roles';

describe('satisfiesRole', () => {
  it('OWNER satisfies every requirement', () => {
    expect(satisfiesRole('OWNER', 'OWNER')).toBe(true);
    expect(satisfiesRole('OWNER', 'ADMIN')).toBe(true);
    expect(satisfiesRole('OWNER', 'MEMBER')).toBe(true);
    expect(satisfiesRole('OWNER', 'GUEST')).toBe(true);
  });

  it('ADMIN satisfies ADMIN and below but not OWNER', () => {
    expect(satisfiesRole('ADMIN', 'OWNER')).toBe(false);
    expect(satisfiesRole('ADMIN', 'ADMIN')).toBe(true);
    expect(satisfiesRole('ADMIN', 'MEMBER')).toBe(true);
    expect(satisfiesRole('ADMIN', 'GUEST')).toBe(true);
  });

  it('MEMBER satisfies MEMBER and GUEST but not ADMIN/OWNER', () => {
    expect(satisfiesRole('MEMBER', 'OWNER')).toBe(false);
    expect(satisfiesRole('MEMBER', 'ADMIN')).toBe(false);
    expect(satisfiesRole('MEMBER', 'MEMBER')).toBe(true);
    expect(satisfiesRole('MEMBER', 'GUEST')).toBe(true);
  });

  it('GUEST satisfies only GUEST', () => {
    expect(satisfiesRole('GUEST', 'OWNER')).toBe(false);
    expect(satisfiesRole('GUEST', 'ADMIN')).toBe(false);
    expect(satisfiesRole('GUEST', 'MEMBER')).toBe(false);
    expect(satisfiesRole('GUEST', 'GUEST')).toBe(true);
  });
});

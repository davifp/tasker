import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { Argon2Service } from './argon2.service';

describe('Argon2Service', () => {
  let service: Argon2Service;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [Argon2Service],
    }).compile();
    service = moduleRef.get(Argon2Service);
  });

  it('hashes a password to an argon2id string', async () => {
    const hash = await service.hash('hunter2');
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('verifies the correct password against its hash', async () => {
    const hash = await service.hash('hunter2');
    expect(await service.verify(hash, 'hunter2')).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await service.hash('hunter2');
    expect(await service.verify(hash, 'wrong')).toBe(false);
  });

  it('returns false (not throws) for a malformed hash', async () => {
    expect(await service.verify('not-a-valid-hash', 'any')).toBe(false);
  });

  it('generates unique hashes for the same password (random salt)', async () => {
    const h1 = await service.hash('same');
    const h2 = await service.hash('same');
    expect(h1).not.toBe(h2);
  });
}, 30_000);

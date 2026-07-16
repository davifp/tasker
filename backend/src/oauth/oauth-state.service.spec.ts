import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { OAuthStateService } from './oauth-state.service';

const mockRedis = {
  set: vi.fn().mockResolvedValue('OK'),
  getdel: vi.fn(),
};

const mockConfig = { get: vi.fn().mockReturnValue(600) };

async function buildService(): Promise<OAuthStateService> {
  const module = await Test.createTestingModule({
    providers: [
      OAuthStateService,
      { provide: Redis, useValue: mockRedis },
      { provide: ConfigService, useValue: mockConfig },
    ],
  }).compile();
  return module.get(OAuthStateService);
}

describe('OAuthStateService', () => {
  let service: OAuthStateService;

  beforeEach(async () => {
    vi.clearAllMocks();
    service = await buildService();
  });

  describe('issue()', () => {
    it('generates a state, stores provider metadata with TTL, and returns the token', async () => {
      const state = await service.issue('GOOGLE');
      expect(typeof state).toBe('string');
      expect(state.length).toBeGreaterThanOrEqual(43);
      expect(mockRedis.set).toHaveBeenCalledWith(
        `oauth:state:${state}`,
        JSON.stringify({ provider: 'GOOGLE' }),
        'EX',
        600,
      );
    });
  });

  describe('consume()', () => {
    it('deletes and validates a matching state — no throw', async () => {
      mockRedis.getdel.mockResolvedValueOnce(JSON.stringify({ provider: 'GOOGLE' }));
      await expect(service.consume('some-state', 'GOOGLE')).resolves.toBeUndefined();
      expect(mockRedis.getdel).toHaveBeenCalledWith('oauth:state:some-state');
    });

    it('throws 400 when the state is missing/expired', async () => {
      mockRedis.getdel.mockResolvedValueOnce(null);
      await expect(service.consume('bad-state', 'GOOGLE')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws 400 when the state was issued for a different provider', async () => {
      mockRedis.getdel.mockResolvedValueOnce(JSON.stringify({ provider: 'GITHUB' }));
      await expect(service.consume('some-state', 'GOOGLE')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws 400 when no state parameter is supplied', async () => {
      await expect(service.consume('', 'GOOGLE')).rejects.toBeInstanceOf(BadRequestException);
      expect(mockRedis.getdel).not.toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { HibpService } from './hibp.service';

describe('HibpService', () => {
  let service: HibpService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [HibpService],
    }).compile();
    service = moduleRef.get(HibpService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when password hash suffix appears in HIBP response', async () => {
    // SHA1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    // Prefix = 5BAA6, suffix = 1E4C9B93F3F0682250B6CF8331B7EE68FD8
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '1E4C9B93F3F0682250B6CF8331B7EE68FD8:1234\r\nABCDEFG:5',
      }),
    );

    expect(await service.isBreached('password')).toBe(true);
  });

  it('returns false when password suffix is not in HIBP response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:999',
      }),
    );

    expect(await service.isBreached('very-unique-password-xyz123')).toBe(false);
  });

  it('falls open (returns false) when HIBP returns non-OK status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => '',
      }),
    );

    expect(await service.isBreached('any')).toBe(false);
  });

  it('falls open (returns false) when fetch throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    expect(await service.isBreached('any')).toBe(false);
  });
});

import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import type { Env } from '@tasker/config';

// Baseline HTTP security headers for the JSON API. Extends the frontend
// `next.config.ts headers()` output — the API surface has no HTML/JS to
// protect (no CSP needed) but still benefits from:
//   - HSTS so future upgrades stay on HTTPS
//   - `X-Content-Type-Options: nosniff` to block MIME-sniff-based type confusion
//   - `Referrer-Policy: strict-origin-when-cross-origin` so leaked URLs do not
//     carry cookies or paths cross-origin
//   - `Permissions-Policy` shrinking the browser feature surface accessible to
//     any embedded content
//   - `X-Frame-Options: DENY` because the API MUST never be framed
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  private readonly enableHsts: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.enableHsts = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  use(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    );
    res.setHeader('X-Frame-Options', 'DENY');
    if (this.enableHsts) {
      // `includeSubDomains` + `preload` follow the HSTS preload requirements.
      // Do not lower `max-age` — 2y is the preload minimum.
      res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    }
    next();
  }
}

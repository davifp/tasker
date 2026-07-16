import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
}

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccess(payload: AccessTokenPayload): string {
    return this.jwt.sign(payload);
  }

  verifyAccess(token: string): AccessTokenPayload {
    return this.jwt.verify<AccessTokenPayload>(token);
  }

  newRefresh(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

// OWASP-recommended argon2id parameters (2023):
// memory=19 MiB (19456 KiB), iterations=2, parallelism=1
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class Argon2Service {
  async hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}

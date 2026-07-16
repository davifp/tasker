import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';

const HIBP_API = 'https://api.pwnedpasswords.com/range/';

@Injectable()
export class HibpService {
  private readonly logger = new Logger(HibpService.name);

  async isBreached(password: string): Promise<boolean> {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    try {
      const res = await fetch(`${HIBP_API}${prefix}`, {
        headers: { 'Add-Padding': 'true' },
        signal: AbortSignal.timeout(3000),
      });

      if (!res.ok) {
        this.logger.warn({ status: res.status }, 'HIBP returned non-OK status — allowing password');
        return false;
      }

      const body = await res.text();
      return body.split('\r\n').some((line) => {
        const [lineSuffix, countStr] = line.split(':');
        return lineSuffix === suffix && Number(countStr) > 0;
      });
    } catch (err) {
      this.logger.warn({ err }, 'HIBP check failed — allowing password');
      return false;
    }
  }
}

import { randomBytes } from 'node:crypto';

export function randomEmail(prefix = 'ada'): string {
  return `${prefix}+${randomBytes(4).toString('hex')}@example.com`;
}

export function randomSlug(prefix = 'ws'): string {
  return `${prefix}-${randomBytes(3).toString('hex')}`;
}

export function randomWorkspaceName(): string {
  return `Acme ${randomBytes(2).toString('hex').toUpperCase()}`;
}

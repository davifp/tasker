import { Prisma } from '@prisma/client';
import { AUDIT_SENSITIVE_KEY_PATTERNS } from '@tasker/config';

const MASKED = '[masked]' as const;

/**
 * Walks a Prisma JSON value and replaces the *value* of any object key whose
 * name (case-insensitive) contains one of the sensitive patterns with the
 * literal string `[masked]`. Arrays and nested objects are recursed. Kept
 * pure and dependency-free so it doubles as a safety net at read time even
 * when writers have already masked at write time.
 */
export function maskSensitiveMetadata(value: Prisma.JsonValue): Prisma.JsonValue {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => maskSensitiveMetadata(item as Prisma.JsonValue)) as Prisma.JsonValue;
  }
  if (typeof value !== 'object') return value;
  const out: Record<string, Prisma.JsonValue> = {};
  for (const [key, val] of Object.entries(value as Record<string, Prisma.JsonValue>)) {
    if (isSensitiveKey(key)) {
      out[key] = MASKED;
    } else {
      out[key] = maskSensitiveMetadata(val);
    }
  }
  return out;
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return AUDIT_SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

import { describe, it, expect } from 'vitest';
import {
  LoginSchema,
  SignupSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  scorePassword,
} from './schemas';

describe('LoginSchema', () => {
  it('accepts a well-formed email + password', () => {
    expect(LoginSchema.safeParse({ email: 'a@b.co', password: 'secret' }).success).toBe(true);
  });

  it('rejects an empty email', () => {
    const result = LoginSchema.safeParse({ email: '', password: 'x' });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed email', () => {
    expect(LoginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
  });
});

describe('SignupSchema', () => {
  it('requires name, valid email, and 8+ char password', () => {
    expect(
      SignupSchema.safeParse({ name: 'Ada', email: 'a@b.co', password: 'abcdefgh' }).success,
    ).toBe(true);
  });

  it('rejects short passwords', () => {
    expect(
      SignupSchema.safeParse({ name: 'Ada', email: 'a@b.co', password: 'short' }).success,
    ).toBe(false);
  });

  it('trims the name and rejects empty', () => {
    expect(
      SignupSchema.safeParse({ name: '   ', email: 'a@b.co', password: 'abcdefgh' }).success,
    ).toBe(false);
  });
});

describe('ForgotPasswordSchema', () => {
  it('accepts a valid email', () => {
    expect(ForgotPasswordSchema.safeParse({ email: 'a@b.co' }).success).toBe(true);
  });
});

describe('ResetPasswordSchema', () => {
  it('accepts when both passwords match', () => {
    const parsed = ResetPasswordSchema.safeParse({
      token: 't',
      password: 'abcdefgh',
      confirmPassword: 'abcdefgh',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects when passwords differ', () => {
    const parsed = ResetPasswordSchema.safeParse({
      token: 't',
      password: 'abcdefgh',
      confirmPassword: 'abcdefgi',
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const paths = parsed.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toContain('confirmPassword');
  });
});

describe('scorePassword', () => {
  it('grows the score as complexity increases', () => {
    expect(scorePassword('')).toBe(0);
    expect(scorePassword('short')).toBe(1);
    expect(scorePassword('abcdefgh')).toBe(2);
    expect(scorePassword('Abcdefgh')).toBe(3);
    expect(scorePassword('Abcdefgh1')).toBe(4);
    expect(scorePassword('Abcdefgh1!')).toBe(5);
    expect(scorePassword('Abcdefghijkl1!')).toBe(5);
  });
});

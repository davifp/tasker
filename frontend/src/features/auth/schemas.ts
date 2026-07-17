import { z } from 'zod';

const emailField = z.string().trim().min(1, 'email.required').email('email.invalid');

const passwordField = z.string().min(8, 'password.min').max(200, 'password.max');

const nameField = z.string().trim().min(1, 'name.required').max(120, 'name.max');

export const LoginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'password.required'),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const SignupSchema = z.object({
  name: nameField,
  email: emailField,
  password: passwordField,
});
export type SignupInput = z.infer<typeof SignupSchema>;

export const ForgotPasswordSchema = z.object({
  email: emailField,
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

export const ResetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: passwordField,
    confirmPassword: z.string().min(1, 'password.required'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'password.mismatch',
    path: ['confirmPassword'],
  });
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

export function scorePassword(password: string): number {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(score, 5);
}

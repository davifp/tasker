export const MAIL_PROVIDER = 'MAIL_PROVIDER' as const;

export type MailTemplate =
  'email-verify' | 'password-reset' | 'invitation' | 'workspace-purge-warning';

export interface MailSendInput {
  template: MailTemplate;
  to: string;
  variables: Record<string, string | number>;
  idempotencyKey?: string;
}

export interface MailProvider {
  send(input: MailSendInput): Promise<{ jobId: string }>;
}

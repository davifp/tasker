export const MAIL_PROVIDER = 'MAIL_PROVIDER' as const;

// Notification-related templates share a `notification-` prefix so the
// MailProcessor subject map can be scanned at a glance. `notification-batch`
// carries a `items` array in `variables` — the Handlebars pipeline supports
// nested structures fine, but we keep the type deliberately permissive.
export type MailTemplate =
  | 'email-verify'
  | 'password-reset'
  | 'invitation'
  | 'workspace-purge-warning'
  | 'notification-mention'
  | 'notification-assignment'
  | 'notification-comment-followed'
  | 'notification-sprint-lifecycle'
  | 'notification-batch';

// Variables are serialised as JSON into a BullMQ job payload, so any nested
// value must round-trip through `JSON.stringify`. The batch template embeds
// an `items` array; scalar templates use only string/number leaves.
export type MailVariableValue =
  string | number | boolean | null | MailVariableValue[] | { [key: string]: MailVariableValue };

export interface MailSendInput {
  template: MailTemplate;
  to: string;
  variables: Record<string, MailVariableValue>;
  idempotencyKey?: string;
}

export interface MailProvider {
  send(input: MailSendInput): Promise<{ jobId: string }>;
}

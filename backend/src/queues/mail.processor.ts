import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';
import * as nodemailer from 'nodemailer';
import * as Handlebars from 'handlebars';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MailSendInput, MailTemplate } from '../common/mail/mail.provider';
import { MAIL_QUEUE } from './constants';

const TEMPLATE_DIR = join(__dirname, '../common/mail/templates');

const SUBJECTS: Record<MailTemplate, string> = {
  'email-verify': 'Verify your email address',
  'password-reset': 'Reset your password',
  invitation: "You've been invited to a workspace",
  'workspace-purge-warning': 'Your workspace will be permanently deleted',
};

type CompiledPair = { html: HandlebarsTemplateDelegate; text: HandlebarsTemplateDelegate };

const templateCache = new Map<MailTemplate, CompiledPair>();

function loadTemplate(name: MailTemplate): CompiledPair {
  const cached = templateCache.get(name);
  if (cached) return cached;

  const html = Handlebars.compile(readFileSync(join(TEMPLATE_DIR, `${name}.hbs`), 'utf8'));
  const text = Handlebars.compile(readFileSync(join(TEMPLATE_DIR, `${name}.txt.hbs`), 'utf8'));
  const pair = { html, text };
  templateCache.set(name, pair);
  return pair;
}

const PERMANENT_SMTP_CODES = new Set([500, 501, 502, 503, 504, 550, 551, 552, 553, 554]);

@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    super();
    this.from = config.get<string>('SMTP_FROM', '"Tasker" <noreply@tasker.dev>');
    const user = config.get<string | undefined>('SMTP_USER');
    this.transporter = nodemailer.createTransport({
      host: config.get<string>('SMTP_HOST', 'localhost'),
      port: config.get<number>('SMTP_PORT', 1025),
      secure: config.get<string>('SMTP_SECURE', 'false') === 'true',
      ...(user ? { auth: { user, pass: config.get<string>('SMTP_PASS', '') } } : {}),
    });
  }

  async process(job: Job<MailSendInput>): Promise<void> {
    const { template, to, variables } = job.data;
    this.logger.log({ jobId: job.id, template, to }, 'Processing mail job');

    const { html: htmlFn, text: textFn } = loadTemplate(template);
    const html = htmlFn(variables);
    const text = textFn(variables);

    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: SUBJECTS[template],
        html,
        text,
      });
      this.logger.log({ jobId: job.id, template, to }, 'Mail sent');
    } catch (err: unknown) {
      const code = (err as { responseCode?: number }).responseCode ?? 0;
      if (PERMANENT_SMTP_CODES.has(code)) {
        this.logger.error(
          { jobId: job.id, template, to, code },
          'Permanent SMTP error — moving to DLQ',
        );
        throw new UnrecoverableError(`Permanent SMTP error ${code}`);
      }
      this.logger.warn(
        { jobId: job.id, template, to, attempt: job.attemptsMade },
        'Transient SMTP error — will retry',
      );
      throw err;
    }
  }
}

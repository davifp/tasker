import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@tasker/config';
import { PrismaService } from '../../prisma/prisma.service';

export interface AiConsentStatus {
  /** True if a matching, current-version consent row exists for the workspace. */
  accepted: boolean;
  /** Version of the document the workspace last accepted (may be stale). */
  acceptedDocumentVersion?: string;
  /** Version currently required by the platform (from `AI_CONSENT_DOCUMENT_VERSION`). */
  requiredDocumentVersion: string;
  /** Timestamp of the last acceptance, if any. */
  acceptedAt?: Date;
  /** User id that accepted the consent, if any. */
  acceptedByUserId?: string;
}

/**
 * CRUD around `WorkspaceAiConsent`, plus a small policy layer that decides
 * whether a workspace's stored consent still satisfies the current
 * `AI_CONSENT_DOCUMENT_VERSION`. Bumping the env value invalidates every
 * prior acceptance without an explicit revoke — the admin must re-accept.
 */
@Injectable()
export class AiConsentService {
  private readonly requiredVersion: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.requiredVersion = this.config.get('AI_CONSENT_DOCUMENT_VERSION', { infer: true });
  }

  async accept(
    workspaceId: string,
    userId: string,
    documentVersion: string = this.requiredVersion,
  ): Promise<void> {
    await this.prisma.forSystem().workspaceAiConsent.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        acceptedByUserId: userId,
        documentVersion,
        updatedAt: new Date(),
      },
      update: {
        acceptedByUserId: userId,
        documentVersion,
        acceptedAt: new Date(),
      },
    });
  }

  async getStatus(workspaceId: string): Promise<AiConsentStatus> {
    const row = await this.prisma
      .forSystem()
      .workspaceAiConsent.findUnique({ where: { workspaceId } });
    if (!row) {
      return { accepted: false, requiredDocumentVersion: this.requiredVersion };
    }
    return {
      accepted: row.documentVersion === this.requiredVersion,
      acceptedDocumentVersion: row.documentVersion,
      requiredDocumentVersion: this.requiredVersion,
      acceptedAt: row.acceptedAt,
      acceptedByUserId: row.acceptedByUserId,
    };
  }

  async isCurrentlyAccepted(workspaceId: string): Promise<boolean> {
    const status = await this.getStatus(workspaceId);
    return status.accepted;
  }
}

import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Invitation, Prisma, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from '../common/security/token.service';
import { MAIL_PROVIDER, MailProvider } from '../common/mail/mail.provider';
import {
  InvitationAcceptedEvent,
  InvitationCreatedEvent,
  InvitationDeclinedEvent,
  InvitationEvents,
  InvitationRevokedEvent,
} from './events/invitation.events';

const INVITATION_TTL_DAYS = 7;

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  // Creates or returns the existing open invitation for (workspaceId, email).
  // The partial unique index makes concurrent inserts collapse to one row.
  async createInvitation(params: {
    workspaceId: string;
    workspaceName: string;
    email: string;
    role: WorkspaceRole;
    invitedByUserId: string;
    inviterName: string;
  }): Promise<Invitation> {
    const email = params.email.toLowerCase();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

    // The token is regenerated inside each branch so the raw token we email
    // is guaranteed to match the hash we just wrote to Postgres. Generating it
    // eagerly before the create/refresh path opens a race: two concurrent
    // calls both generate tokens, both lose/win the partial-unique index in
    // different orders, and the winner of the mail race can end up emailing a
    // raw token whose hash the DB no longer has.
    let invitation: Invitation;
    let refreshed = false;
    let token: string;
    try {
      const generated = this.tokenService.generateToken();
      token = generated.token;
      invitation = await this.prisma.forSystem().invitation.create({
        data: {
          workspaceId: params.workspaceId,
          email,
          role: params.role,
          tokenHash: generated.hash,
          invitedByUserId: params.invitedByUserId,
          expiresAt,
        },
      });
    } catch (err) {
      if (!isOpenInvitationCollision(err)) throw err;

      const existing = await this.prisma.forSystem().invitation.findFirst({
        where: { workspaceId: params.workspaceId, email, acceptedAt: null, revokedAt: null },
      });
      if (!existing) throw err;

      // Generate the new token AFTER the collision so the update we're about
      // to run is the last writer for this row — no concurrent caller can
      // overwrite our tokenHash before we email its raw form.
      const refresh = this.tokenService.generateToken();
      token = refresh.token;
      invitation = await this.prisma.forSystem().invitation.update({
        where: { id: existing.id },
        data: { tokenHash: refresh.hash, role: params.role, expiresAt },
      });
      refreshed = true;
    }

    const baseUrl = this.config.get<string>('APP_BASE_URL', 'http://localhost:3000');
    const acceptUrl = `${baseUrl}/invitations/${token}`;

    await this.mail.send({
      template: 'invitation',
      to: email,
      variables: {
        workspaceName: params.workspaceName,
        inviterName: params.inviterName,
        role: params.role,
        acceptUrl,
      },
      idempotencyKey: `invitation-${invitation.id}`,
    });

    this.events.emit(InvitationEvents.CREATED, {
      invitationId: invitation.id,
      workspaceId: invitation.workspaceId,
      invitedByUserId: params.invitedByUserId,
      email,
      role: params.role,
      refreshed,
    } satisfies InvitationCreatedEvent);

    return invitation;
  }

  async listInvitations(workspaceId: string): Promise<Invitation[]> {
    return this.prisma.forSystem().invitation.findMany({
      where: { workspaceId, acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(invitationId: string, workspaceId: string, actorUserId: string): Promise<void> {
    const invitation = await this.prisma
      .forSystem()
      .invitation.findUnique({ where: { id: invitationId } });
    if (!invitation || invitation.workspaceId !== workspaceId) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.acceptedAt) {
      throw new BadRequestException('Invitation was already accepted');
    }
    if (invitation.revokedAt) return; // idempotent no-op
    await this.prisma.forSystem().invitation.update({
      where: { id: invitationId },
      data: { revokedAt: new Date() },
    });
    this.events.emit(InvitationEvents.REVOKED, {
      invitationId,
      workspaceId,
      actorUserId,
    } satisfies InvitationRevokedEvent);
  }

  // Resolves a raw invitation token, ensuring it is valid, unexpired, and
  // matches the caller (email). Returns the loaded invitation for the caller
  // to accept or decline.
  private async resolveByToken(rawToken: string): Promise<Invitation> {
    const hash = this.tokenService.hash(rawToken);
    const invitation = await this.prisma
      .forSystem()
      .invitation.findUnique({ where: { tokenHash: hash } });
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.acceptedAt || invitation.revokedAt) {
      throw new GoneException('Invitation is no longer valid');
    }
    if (invitation.expiresAt < new Date()) {
      throw new GoneException('Invitation has expired');
    }
    return invitation;
  }

  async acceptInvitation(rawToken: string, actorUserId: string): Promise<{ workspaceId: string }> {
    const invitation = await this.resolveByToken(rawToken);
    const user = await this.prisma.forSystem().user.findUnique({ where: { id: actorUserId } });
    if (!user) throw new UnauthorizedException('Authenticated user not found');

    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new ConflictException({
        type: 'https://tasker.dev/problems/invitation-email-mismatch',
        title: 'Invitation email mismatch',
        detail:
          'This invitation was sent to a different email address than the one on your account.',
        status: 409,
      });
    }

    await this.prisma.forSystem().$transaction(async (tx) => {
      await tx.workspaceMember.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: invitation.workspaceId,
            userId: actorUserId,
          },
        },
        create: {
          workspaceId: invitation.workspaceId,
          userId: actorUserId,
          role: invitation.role,
        },
        update: {}, // membership already exists — accept is a no-op
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
    });

    this.events.emit(InvitationEvents.ACCEPTED, {
      invitationId: invitation.id,
      workspaceId: invitation.workspaceId,
      actorUserId,
      role: invitation.role,
    } satisfies InvitationAcceptedEvent);

    return { workspaceId: invitation.workspaceId };
  }

  async declineInvitation(rawToken: string): Promise<void> {
    const invitation = await this.resolveByToken(rawToken);
    await this.prisma.forSystem().invitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date() },
    });
    this.events.emit(InvitationEvents.DECLINED, {
      invitationId: invitation.id,
      workspaceId: invitation.workspaceId,
      email: invitation.email,
    } satisfies InvitationDeclinedEvent);
  }
}

// Prisma reports our partial unique index as target: ["workspaceId", "email"]
// via err.meta on P2002. Discriminate against the tokenHash unique index (which
// would target: ["tokenHash"]) so we only refresh on the intended collision.
function isOpenInvitationCollision(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
    return false;
  }
  const meta = err.meta as { modelName?: string; target?: string | string[] } | undefined;
  if (meta?.modelName !== 'Invitation') return false;
  const target = meta.target;
  const cols = typeof target === 'string' ? [target] : Array.isArray(target) ? target : [];
  return cols.includes('workspaceId') && cols.includes('email');
}

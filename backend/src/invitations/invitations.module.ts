import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../common/mail/mail.module';
import { UsersModule } from '../users/users.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { InvitationsService } from './invitations.service';
import {
  PublicInvitationsController,
  WorkspaceInvitationsController,
} from './invitations.controller';

@Module({
  imports: [PrismaModule, MailModule, UsersModule, WorkspacesModule],
  controllers: [WorkspaceInvitationsController, PublicInvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}

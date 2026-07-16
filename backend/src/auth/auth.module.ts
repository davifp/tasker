import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { EmailVerificationService } from './email-verification.service';
import { EmailVerificationController } from './email-verification.controller';
import { PasswordResetService } from './password-reset.service';
import { PasswordResetController } from './password-reset.controller';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { UsersModule } from '../users/users.module';
import { SessionsModule } from '../sessions/sessions.module';
import { MailModule } from '../common/mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PassportModule, UsersModule, SessionsModule, MailModule, PrismaModule],
  providers: [
    AuthService,
    EmailVerificationService,
    PasswordResetService,
    LocalStrategy,
    JwtStrategy,
    LocalAuthGuard,
  ],
  controllers: [AuthController, EmailVerificationController, PasswordResetController],
  exports: [AuthService, EmailVerificationService],
})
export class AuthModule {}

import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { UsersModule } from '../users/users.module';
import { SessionsModule } from '../sessions/sessions.module';

@Module({
  imports: [PassportModule, UsersModule, SessionsModule],
  providers: [AuthService, LocalStrategy, JwtStrategy, LocalAuthGuard],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}

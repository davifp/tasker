import { Body, Controller, HttpCode, HttpStatus, Post, Request } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request as ExpressRequest } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { JwtUser } from './strategies/jwt.strategy';
import { EmailVerificationService } from './email-verification.service';
import { VerifyEmailDto } from './dto/verify-email.dto';

@Controller('auth')
export class EmailVerificationController {
  constructor(private readonly emailVerification: EmailVerificationService) {}

  @Post('email/verify')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  verify(@Body() dto: VerifyEmailDto): Promise<void> {
    return this.emailVerification.verify(dto.token);
  }

  @Post('email/verify/resend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ emailResend: {} })
  resend(@Request() req: ExpressRequest & { user: JwtUser }): Promise<void> {
    return this.emailVerification.resend(req.user.userId);
  }
}

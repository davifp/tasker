import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto';
import { PasswordResetService } from './password-reset.service';

@Controller('auth/password')
export class PasswordResetController {
  constructor(private readonly passwordReset: PasswordResetService) {}

  @Post('reset/request')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ passwordReset: {} })
  request(@Body() dto: PasswordResetRequestDto): Promise<void> {
    return this.passwordReset.requestReset(dto.email);
  }

  @Post('reset/confirm')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ passwordReset: {} })
  confirm(@Body() dto: PasswordResetConfirmDto): Promise<void> {
    return this.passwordReset.confirmReset(dto.token, dto.password);
  }
}

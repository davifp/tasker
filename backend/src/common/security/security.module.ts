import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Argon2Service } from './argon2.service';
import { HibpService } from './hibp.service';
import { TokenService } from './token.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>(
            'JWT_ACCESS_TTL',
            '15m',
          ) as `${number}${'s' | 'm' | 'h' | 'd'}`,
        },
      }),
    }),
  ],
  providers: [Argon2Service, HibpService, TokenService],
  exports: [Argon2Service, HibpService, TokenService, JwtModule],
})
export class SecurityModule {}

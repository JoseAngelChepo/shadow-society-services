import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { SignOptions } from 'jsonwebtoken';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { UsersModule } from '../users/users.module';
import { SessionsModule } from '../sessions/sessions.module';
import { EmailsModule } from '../emails/emails.module';
import { UserApiTokensModule } from '../user-api-tokens/user-api-tokens.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { GoogleOAuthIntegration } from '../integrations/google-oauth.integration';

const googleStrategyProvider: Provider = {
  provide: GoogleStrategy,
  useFactory: (
    config: ConfigService,
    googleOAuth: GoogleOAuthIntegration,
  ): GoogleStrategy | null => {
    if (!googleOAuth.isConfigured()) {
      return null;
    }
    return new GoogleStrategy(config, googleOAuth);
  },
  inject: [ConfigService, GoogleOAuthIntegration],
};

@Module({
  imports: [
    UsersModule,
    SessionsModule,
    EmailsModule,
    UserApiTokensModule,
    IntegrationsModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '7d') as SignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, googleStrategyProvider],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}

import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { GoogleOAuthIntegration } from '../../integrations/google-oauth.integration';

type GoogleOAuthProfile = {
  id: string;
  name?: { givenName?: string; familyName?: string };
  emails?: Array<{ value?: string }>;
  photos?: Array<{ value?: string }>;
};

/** Registered only when {@link GoogleOAuthIntegration} is configured. */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    configService: ConfigService,
    googleOAuth: GoogleOAuthIntegration,
  ) {
    super({
      clientID: configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: configService.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: googleOAuth.callbackUrl(),
      scope: ['email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: GoogleOAuthProfile,
    done: VerifyCallback,
  ): Promise<void> {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      done(new Error('Google account email is required'), false);
      return;
    }

    done(null, {
      googleId: profile.id,
      email,
      firstName: profile.name?.givenName ?? '',
      lastName: profile.name?.familyName ?? '',
      avatar: profile.photos?.[0]?.value,
    });
  }
}

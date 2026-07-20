import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hasRequiredEnv } from '../common/integrations/has-required-env';
import type { OptionalIntegration } from '../common/integrations/optional-integration.interface';

@Injectable()
export class GoogleOAuthIntegration implements OptionalIntegration {
  readonly integrationId = 'google-oauth';
  private readonly logger = new Logger(GoogleOAuthIntegration.name);

  constructor(private readonly config: ConfigService) {
    if (!this.isConfigured()) {
      this.logger.warn(
        'Google OAuth is disabled. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable it.',
      );
    }
  }

  isConfigured(): boolean {
    return hasRequiredEnv(this.config, [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
    ]);
  }

  callbackUrl(): string {
    return (
      this.config.get<string>('GOOGLE_CALLBACK_URL')?.trim() ||
      'http://localhost:3001/api/v1/auth/google/callback'
    );
  }
}

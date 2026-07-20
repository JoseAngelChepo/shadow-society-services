import { Injectable } from '@nestjs/common';
import { GoogleOAuthIntegration } from './google-oauth.integration';
import { ResendService } from '../emails/services/resend.service';

export type IntegrationStatusMap = Record<
  string,
  { configured: boolean }
>;

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly googleOAuth: GoogleOAuthIntegration,
    private readonly resend: ResendService,
  ) {}

  listStatus(): IntegrationStatusMap {
    return {
      [this.googleOAuth.integrationId]: {
        configured: this.googleOAuth.isConfigured(),
      },
      [this.resend.integrationId]: {
        configured: this.resend.isConfigured(),
      },
    };
  }
}

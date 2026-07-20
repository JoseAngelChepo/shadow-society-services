import {
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GoogleOAuthIntegration } from '../../integrations/google-oauth.integration';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(private readonly googleOAuth: GoogleOAuthIntegration) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    if (!this.googleOAuth.isConfigured()) {
      throw new ServiceUnavailableException(
        'Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
      );
    }
    return super.canActivate(context);
  }

  getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const raw = request.query?.state;
    const state = Array.isArray(raw) ? raw[0] : raw;
    if (typeof state === 'string' && state.length > 0) {
      return { state };
    }
    return {};
  }
}

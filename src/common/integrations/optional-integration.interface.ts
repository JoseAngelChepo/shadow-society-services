/**
 * Optional third-party integrations must not block app boot when unconfigured.
 * Implement this on provider services (Resend, Google OAuth, future banking/telephony).
 */
export interface OptionalIntegration {
  readonly integrationId: string;
  isConfigured(): boolean;
}

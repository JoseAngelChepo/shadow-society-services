# Optional integrations

Third-party providers (email, OAuth, future banking/telephony) must follow the same rules:

1. Implement `OptionalIntegration` (`src/common/integrations/optional-integration.interface.ts`).
2. Do **not** instantiate SDK clients when credentials are missing.
3. Expose `isConfigured()` and return a clear error (or no-op) at call time — never crash app boot.
4. Register the integration in `IntegrationsService` for `/health` visibility.

## Current integrations

| ID | Service | Env vars |
|----|---------|----------|
| `resend` | `ResendService` | `RESEND_API_KEY` + sender (`EMAIL_FROM` or `RESEND_FROM_EMAIL`) |
| `google-oauth` | `GoogleOAuthIntegration` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |

Google Passport strategy is registered only when `google-oauth` is configured.

## Adding a new provider

1. Create `src/integrations/<name>.integration.ts` implementing `OptionalIntegration`.
2. Lazy-init any SDK in the service constructor only when `isConfigured()` is true.
3. Add it to `IntegrationsService.listStatus()`.
4. Document env vars in `.env.example`.

# shadow-society-services — docs

## API prefix

All routes are under **`/api/v1`**.

## Topic guides

| Topic | File |
|-------|------|
| **Optional integrations (Resend, OAuth, …)** | [`INTEGRATIONS.md`](./INTEGRATIONS.md) |
| **New modules & linking to users** | [`MODULES.md`](./MODULES.md) |
| Auth guards (required, optional, PAT) | [`GUARDS.md`](./GUARDS.md) |
| Role guard (`@Roles`, admin vs user) | [`role-guard-implementation.md`](./role-guard-implementation.md) |

## Health (public)

- `GET /health` — app + MongoDB status and optional integration flags (`google-oauth`, `resend`)

## Auth (public)

- `POST /auth/register` — email/password sign-up (`RegisterDto`: username 3–30, `a-z`, `0-9`, `_`)
- `GET /auth/username/availability?username=`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/forgot-password` / `POST /auth/reset-password`
- `GET /auth/google` / `GET /auth/google/callback`

## Auth (authenticated)

- `POST /auth/logout` — body: `{ refresh_token }`
- `POST /auth/logout-all`
- `GET /auth/me`
- `POST|GET|DELETE /auth/api-tokens` — user PAT management

## Users

- `GET /users/me` — same profile shape as `/auth/me` (convenience for the platform client)
- Admin: `GET /users`, `GET /users/:id`, `PATCH /users/:id` (requires `admin` role)

## Adding public API routes later

Use **`OptionalJwtAuthGuard`** + **`@OptionalUser()`** when the route is public but should enrich the response for logged-in callers. See [`GUARDS.md`](./GUARDS.md).

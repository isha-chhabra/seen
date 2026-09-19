# @workspace/cloud

Deployment factory and auth/email integrations for the managed Seen Cloud offering (`DEPLOYMENT_MODE=cloud`).

## Required environment variables

The auth and email features in this package need:

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Resend API key for transactional email |
| `RESEND_FROM_EMAIL` | Sender address, e.g. `Seen <notifications@updates.example.com>` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID for social sign-in |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |

The canonical list of every cloud-required variable (Stripe, database, etc.) lives in `packages/config/src/env-registry.ts`; env validation fails cloud startup when any of them is missing.

## Resend setup

1. Create an API key in the [Resend dashboard](https://resend.com) and set it as `RESEND_API_KEY`.
2. Verify the sending domain: add the SPF and DKIM DNS records Resend shows for the domain (e.g. `updates.example.com`).
3. Set `RESEND_FROM_EMAIL` to a display-name form on that verified domain, e.g. `Seen <notifications@updates.example.com>`.

Email templates are code — `packages/cloud/src/email-templates.ts` — not Resend-hosted templates; there is nothing to configure template-side in Resend.

## Brevo setup (no domain needed)

An alternative to Resend that works without owning a domain. Brevo wins when both are configured.

1. Create a free [Brevo](https://www.brevo.com) account and add a sender under Senders, Domains & Dedicated IPs (Brevo emails that address a code to confirm it).
2. Create an API key (SMTP & API, API Keys) and set it as `BREVO_API_KEY`.
3. Set `BREVO_FROM_EMAIL` to the verified sender, e.g. `Seen <you@example.com>`.

Sending uses Brevo's HTTPS API, not SMTP (DigitalOcean droplets block SMTP ports).

## Google OAuth setup

1. In the Google Cloud console, create an OAuth client of type **Web application**.
2. Authorized redirect URI: `${APP_URL}/api/auth/callback/google`.
3. Authorized JavaScript origin: `${APP_URL}`.
4. Set the resulting client ID and secret as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

## Behavior notes

- Email/password sign-in requires a verified email. A 6-digit code is emailed on signup, unverified sign-in attempts email a fresh one, and entering it verifies the address and signs the user in.
- Google-provided emails arrive verified, so OAuth users are never blocked by verification.
- Team invitations expire after 48 hours (better-auth default). Untouched invitations simply lapse; there is no decline step.
- Disposable-email domains are rejected at signup (both email/password and OAuth) via the `disposable-email-domains` package; the blocklist updates through normal dependency bumps.

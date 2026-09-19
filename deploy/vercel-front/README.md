# Vercel front door

A `vercel.json`-only project that forwards every request to the app on the
droplet, so people use a short `*.vercel.app` address instead of the server's
sslip.io one. There is no code here and no build.

- Import this repo in Vercel with **Root Directory** set to `deploy/vercel-front`
  and Framework Preset **Other**. The project name you choose becomes
  `<name>.vercel.app`.
- `installCommand` is empty on purpose: this project has nothing to install, and
  the monorepo's root install would otherwise run (and fail a frozen-lockfile
  check).
- Set `APP_URL` in the droplet's `.env` to that address, or sign-in is rejected
  (better-auth checks the browser's Origin against `APP_URL`).
- Caching is switched off (`x-vercel-enable-rewrite-caching: 0`) so a proxied,
  signed-in page can never be served to someone else.
- Vercel gives a proxied request 120 seconds. Anything longer must return early
  and be polled (Article Finder does).

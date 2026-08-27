# Convex Auth setup

A one-time list. Once everything here is done, the hero's "Scan now" button
sends a signed-out visitor to `/login`, and after sign-in they land back on
the hero with the URL they typed already in the box.

The deployment is `shiny-sparrow-790` (https://dashboard.convex.dev/d/shiny-sparrow-790).

## 1. Authenticate the CLI

The `npx convex env set` commands below need a deploy key. The CLI looks for
`CONVEX_DEPLOY_KEY` in the environment.

1. Open https://dashboard.convex.dev/d/shiny-sparrow-790/settings/deployment-keys
2. Click **Generate Production Deploy Key** (or Dev if you're working in dev).
3. Copy it into `apps/web/.env.local` (already gitignored):

   ```sh
   CONVEX_DEPLOY_KEY=prod:shiny-sparrow-790:xxxxxxxx
   ```

4. Export it for the current shell, or restart the dev server so Next picks it up:

   ```sh
   export CONVEX_DEPLOY_KEY=$(grep ^CONVEX_DEPLOY_KEY apps/web/.env.local | cut -d= -f2-)
   ```

## 2. Push the secrets

These have to be on the Convex deployment, NOT in the Next.js `.env` —
Convex functions run on Convex and cannot read the app's environment.

```sh
cd apps/web
npx convex env set AUTH_GITHUB_ID      Ov23liCBCzgB6tpX4Dz6
npx convex env set AUTH_GITHUB_SECRET  9abd814a71ed27932dbbe7c0a9b202047e66e6d9
npx convex env set AUTH_GOOGLE_ID      375864774544-l3mjvstmnpqvemn283bvacqecba571qs.apps.googleusercontent.com
npx convex env set AUTH_GOOGLE_SECRET  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
npx convex env set AUTH_RESEND_KEY     re_PD8J8gjM_BTkZS6U9MPmBw5BHjpMt5iTg
npx convex env set AUTH_EMAIL_FROM     "Darvin <onboarding@resend.dev>"
npx convex env set SITE_URL            http://localhost:3000
```

Verify:

```sh
npx convex env get AUTH_GITHUB_ID
```

## 3. Register the OAuth callback URLs

The redirect URI Convex uses is `<CONVEX_SITE_URL>/api/auth/callback/<provider>`,
where `CONVEX_SITE_URL` is the deployment's own `*.convex.site` origin (NOT
`*.convex.cloud`). The current one is
`https://shiny-sparrow-790.convex.site`.

Add these to each provider's OAuth app:

| Provider | Callback URL                                                            |
| -------- | ----------------------------------------------------------------------- |
| GitHub   | `https://shiny-sparrow-790.convex.site/api/auth/callback/github`        |
| Google   | `https://shiny-sparrow-790.convex.site/api/auth/callback/google`        |

**GitHub**: Settings → Developer settings → OAuth Apps → Darvin →
Authorization callback URL. Save.

**Google**: Google Cloud Console → APIs & Services → Credentials → OAuth 2.0
Client IDs → the Darvin client → Authorized redirect URIs. Add the URL.
Save.

For production, also add the production Convex site's URL when the
deployment is promoted.

## 4. Push the schema

The auth tables need to exist on the deployment before the first sign-in:

```sh
cd apps/web
npx convex dev --once --push
```

(`--once` exits after the push rather than starting the watch loop.)

## 5. Test it

```sh
cd apps/web
pnpm dev
```

Open http://localhost:3000, paste a URL, click **Scan now**. You should be
redirected to `/login?next=/`. Sign in with Google or GitHub, and you should
land back on the hero with the URL already in the box. Press **Scan now**
again — the scan will start and route to `/scan/<id>`.

## Email codes (Resend)

Resend's free tier only delivers from `onboarding@resend.dev` to the address
that owns the Resend account. Before testing the email flow, either verify
your own domain in Resend and update `AUTH_EMAIL_FROM`, or add your
destination address as a test recipient on the Resend dashboard.

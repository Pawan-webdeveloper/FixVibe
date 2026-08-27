# Convex Auth setup

A one-time list. Once everything here is done, the hero's "Scan now" button
sends a signed-out visitor to `/login`, and after sign-in they land back on
the hero with the URL they typed already in the box.

The deployment is `shiny-sparrow-790` (https://dashboard.convex.dev/d/shiny-sparrow-790).

> **Rotate before going to production.** An earlier revision of this file
> committed the live GitHub OAuth secret, Google OAuth secret and Resend API
> key in plaintext, and `CONVEX_DEPLOY_KEY` was sent through chat. Deleting
> them from the working copy does not remove them from the git history, so all
> four must be regenerated on their dashboards and re-pushed with the commands
> in §2. Until that is done, treat every one of them as known.

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

Take each value from the provider's own dashboard at the moment you run this.
**Do not paste real values back into this file** — it is version-controlled,
and a secret committed once stays in the history even after it is deleted.

```sh
cd apps/web
npx convex env set AUTH_GITHUB_ID      "<github oauth app client id>"
npx convex env set AUTH_GITHUB_SECRET  "<github oauth app client secret>"
npx convex env set AUTH_GOOGLE_ID      "<google oauth client id>"
npx convex env set AUTH_GOOGLE_SECRET  "<google oauth client secret>"
npx convex env set AUTH_RESEND_KEY     "<resend api key>"
npx convex env set AUTH_EMAIL_FROM     "ScanlyFix <onboarding@resend.dev>"
npx convex env set SITE_URL            "<the app's own origin>"
```

`npx convex env set` reads-modifies-writes the whole environment, so running
these concurrently fails with `OptimisticConcurrencyControlFailure`. Set them
one at a time.

`SITE_URL` is the Next.js app's origin, not Convex's: `http://localhost:3000`
in development and the deployed domain in production. It is what the sign-in
links in emails point at, so a stale value sends real users to localhost.

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

**GitHub**: Settings → Developer settings → OAuth Apps → ScanlyFix →
Authorization callback URL. Save.

**Google**: Google Cloud Console → APIs & Services → Credentials → OAuth 2.0
Client IDs → the ScanlyFix client → Authorized redirect URIs. Add the URL.
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

While `AUTH_EMAIL_FROM` is Resend's sandbox sender (`onboarding@resend.dev`),
Resend delivers **only to the address that owns the Resend account** and
refuses everything else. Anyone else asking for a code gets a failure.

That is fine for testing and fatal in production, so it is worth being precise
about which of the two failures you are looking at — they are different HTTP
statuses with different fixes:

| Status | Resend says | Means |
| --- | --- | --- |
| 403 | "You can only send testing emails to your own email address" | The key is live and working; the recipient is simply not the account owner. Sandbox limit. |
| 422 | "Invalid `to` field ... domains like `example.com`" | The recipient address is one Resend refuses outright. |
| 401 | "API key is invalid" | Wrong key, or `AUTH_RESEND_KEY` is unset on the deployment. |

Neither message reaches the person signing in — the 403 body names the account
owner's own email address, so all of them are logged and replaced with a fixed
sentence. See `components/auth/sign-in-error.ts`. Read the real reason in the
Convex logs, under `[ResendOTP] delivery failed`.

**The key has to be the one belonging to the Resend account you intend to
send from**, and it lives on the Convex deployment rather than in `.env` —
`AUTH_RESEND_KEY` in the repo's `.env` is not what Convex functions read. When
sign-in emails fail for one address and work for another, check that the two
are the same key:

```sh
cd apps/web && npx convex env get AUTH_RESEND_KEY
```

### Going to production

Verify a domain at resend.com/domains, then point the sender at it:

```sh
cd apps/web
npx convex env set AUTH_EMAIL_FROM "ScanlyFix <auth@yourdomain.com>"
```

Until that is done the email option works for exactly one person, and Google
and GitHub are the only sign-in methods anybody else can use.

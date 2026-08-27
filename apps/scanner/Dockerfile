# The browser tier.
#
# Built on Microsoft's Playwright image because it already carries a Chromium
# matched to the playwright-core version below AND the ~80 shared libraries
# headless Chrome needs on Linux. Installing those by hand onto a slim base is
# a day of work that breaks on the next Chromium bump; the size is worth it.
#
# Keep the tag in step with playwright-core in package.json. A browser built
# for a different protocol revision fails at launch, not at build.
FROM mcr.microsoft.com/playwright:v1.57.0-noble

ENV NODE_ENV=production \
    PNPM_HOME=/usr/local/bin \
    # Chromium's own sandbox needs kernel capabilities a hardened container
    # does not grant, and the container IS the boundary here. Outside a
    # container this stays unset and the sandbox stays on — see browser.ts.
    SCANLYFIX_DISABLE_BROWSER_SANDBOX=1
RUN corepack enable

WORKDIR /app

# Manifests first, so a source-only change does not reinstall the workspace.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/scanner/package.json ./apps/scanner/
COPY packages/checks/package.json ./packages/checks/

# --filter pulls in @scanlyfix/checks, which this service uses for the SSRF guard.
RUN pnpm install --frozen-lockfile --filter @scanlyfix/scanner...

COPY packages/checks ./packages/checks
COPY apps/scanner ./apps/scanner

# The engine and this service both ship raw TypeScript; Node strips the types
# at load. There is no build step to keep in sync with the source.
WORKDIR /app/apps/scanner
EXPOSE 8080

# Runs as the image's non-root `pwuser`. Nothing here needs to write to disk.
USER pwuser

# SCANLYFIX_SCANNER_TOKEN must be supplied at run time. The process refuses to
# start without it rather than listening unauthenticated — see src/index.ts.
CMD ["node", "--experimental-strip-types", "src/index.ts"]

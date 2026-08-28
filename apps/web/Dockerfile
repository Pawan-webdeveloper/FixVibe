# syntax=docker/dockerfile:1
#
# Web app image. Build from the REPO ROOT so the workspace packages are in
# context:
#
#   docker build -f apps/web/Dockerfile -t scanlyfix-web .
#   docker run -p 3000:3000 --env-file .env scanlyfix-web
#
# Two stages: build the standalone server against the whole monorepo, then ship
# only `.next/standalone` (server + its traced node_modules) on a clean base.
# The image carries no Chromium — the web app calls the scanner over HTTP, so
# the browser lives in the scanner image, not this one.

# ---- build ----
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
# Copy the whole workspace: the web build transpiles @scanlyfix/checks and
# @scanlyfix/db from source, so they have to be present.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @scanlyfix/web build

# ---- run ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Do not run as root.
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# The standalone server and its traced dependencies, then the assets Next
# serves relative to it. outputFileTracingRoot put server.js under apps/web.
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000

# The platform's health check can hit /api/health.
CMD ["node", "apps/web/server.js"]

# teamplanner Nuxt 4 app - builds the full-stack Nuxt output, runs the Nitro Node server.
# Single container serves the app pages and the /api/* server routes; the startup
# migration plugin (server/plugins/migrate.ts) applies Drizzle migrations against
# DATABASE_URL (Postgres in this stack) and seeds the F22 bootstrap admin on a
# fresh database.

# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /build

COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY app/ ./
RUN npm run build

# ---- runtime stage ----
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NITRO_PORT=3000 \
    NITRO_HOST=0.0.0.0

COPY --from=build /build/.output /app/.output
# Drizzle migrations are applied at startup and are not part of the Nitro bundle;
# ship them at the path the default cwd resolution in server/utils/db.ts expects.
COPY --from=build /build/server/db/migrations /app/server/db/migrations

RUN addgroup -g 10001 app && adduser -D -u 10001 -G app -s /sbin/nologin app && chown -R app:app /app
USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/healthz > /dev/null || exit 1

CMD ["node", ".output/server/index.mjs"]

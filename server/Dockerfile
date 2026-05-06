# syntax=docker/dockerfile:1
# Debian-based image: better-sqlite3 ships prebuilt binaries for glibc but not
# musl, so alpine would force a native build. bookworm-slim is small enough.
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

FROM base AS runtime
COPY --from=deps /app/node_modules /app/node_modules
COPY package.json ./
COPY src ./src
COPY migrations ./migrations
COPY public ./public

# Persistent volume mount target. Fly.io will mount the volume here.
RUN mkdir -p /data
ENV DB_PATH=/data/mail.db
ENV HOST=0.0.0.0
ENV PORT=8787
EXPOSE 8787

# Drop root for runtime.
USER node

CMD ["node", "src/index.js"]

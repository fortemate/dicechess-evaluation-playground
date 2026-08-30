# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM node:26-trixie-slim AS build

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN --mount=type=secret,id=node_auth_token,required=false \
    if [ -f /run/secrets/node_auth_token ]; then \
      export NODE_AUTH_TOKEN="$(cat /run/secrets/node_auth_token)"; \
    else \
      export NODE_AUTH_TOKEN=unused; \
    fi; \
    npm ci --ignore-scripts

COPY svelte.config.js tsconfig.json vite.config.ts ./
COPY src ./src
COPY static ./static
RUN npm run build

FROM node:26-trixie-slim AS production-deps

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN --mount=type=secret,id=node_auth_token,required=false \
    if [ -f /run/secrets/node_auth_token ]; then \
      export NODE_AUTH_TOKEN="$(cat /run/secrets/node_auth_token)"; \
    else \
      export NODE_AUTH_TOKEN=unused; \
    fi; \
    npm ci --omit=dev --ignore-scripts \
    && mkdir -p node_modules \
    && npm cache clean --force

FROM node:26-trixie-slim AS runtime

ARG APP_VERSION=dev

LABEL org.opencontainers.image.title="Dice Chess Evaluation Playground" \
      org.opencontainers.image.description="Private interactive playground for testing Dice Chess evaluation models" \
      org.opencontainers.image.url="https://github.com/fortemate/dicechess-evaluation-playground" \
      org.opencontainers.image.source="https://github.com/fortemate/dicechess-evaluation-playground" \
      org.opencontainers.image.documentation="https://github.com/fortemate/dicechess-evaluation-playground#readme" \
      org.opencontainers.image.vendor="Fortemate" \
      org.opencontainers.image.licenses="LicenseRef-Proprietary" \
      org.opencontainers.image.authors="Jegors Čemisovs" \
      org.opencontainers.image.base.name="docker.io/library/node:26-trixie-slim"

RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --create-home --home-dir /home/app app

WORKDIR /app

COPY --from=production-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/build ./build
COPY --chown=app:app package.json ./

USER app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    BODY_SIZE_LIMIT=64K \
    SHUTDOWN_TIMEOUT=30 \
    APP_VERSION=$APP_VERSION

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "const port = process.env.PORT || '3000'; fetch('http://127.0.0.1:' + port + '/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "build"]

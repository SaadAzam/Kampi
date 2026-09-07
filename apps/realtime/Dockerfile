FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable && apk add --no-cache openssl libc6-compat

FROM base AS build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY patches ./patches
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate
RUN pnpm --filter @kampi/realtime... build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
# Docker COPY can drop pnpm workspace symlinks; Colyseus needs this package at runtime.
RUN mkdir -p node_modules/@colyseus \
  && rm -rf node_modules/@colyseus/greeting-banner \
  && cp -a packages/colyseus-greeting-shim node_modules/@colyseus/greeting-banner
EXPOSE 2567
CMD ["node", "apps/realtime/dist/index.js"]

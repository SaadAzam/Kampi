FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable && apk add --no-cache openssl libc6-compat

FROM base AS build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile --filter @kampi/api...
RUN pnpm db:generate
RUN pnpm --filter @kampi/api... build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 4000
CMD ["sh", "-c", "pnpm db:migrate && node apps/api/dist/main.js"]

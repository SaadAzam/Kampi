FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/realtime/package.json apps/realtime/
COPY packages/colyseus-greeting-shim/package.json packages/colyseus-greeting-shim/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY packages/domain/package.json packages/domain/
RUN pnpm install --frozen-lockfile --filter @kampi/realtime...

FROM deps AS build
COPY . .
RUN pnpm db:generate
RUN pnpm --filter @kampi/realtime build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/realtime/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/realtime/package.json ./
EXPOSE 2567
CMD ["node", "dist/index.js"]

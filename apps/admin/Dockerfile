FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY patches ./patches
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile --filter @kampi/admin...
RUN pnpm --filter @kampi/admin build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/apps/admin/.next/standalone ./
COPY --from=build /app/apps/admin/.next/static ./apps/admin/.next/static
EXPOSE 3000
CMD ["node", "apps/admin/server.js"]

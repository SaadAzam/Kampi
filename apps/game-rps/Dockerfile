FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/game-rps/package.json apps/game-rps/
COPY packages/colyseus-greeting-shim/package.json packages/colyseus-greeting-shim/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/game-sdk/package.json packages/game-sdk/
RUN pnpm install --frozen-lockfile --filter @kampi/game-rps...

FROM deps AS build
COPY . .
RUN pnpm --filter @kampi/game-rps build

FROM nginx:1.27-alpine AS runner
COPY --from=build /app/apps/game-rps/dist /usr/share/nginx/html
COPY apps/game-rps/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

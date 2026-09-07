FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
ARG VITE_REALTIME_PUBLIC_URL
ENV VITE_REALTIME_PUBLIC_URL=$VITE_REALTIME_PUBLIC_URL
RUN pnpm install --frozen-lockfile --filter @kampi/game-penalty-app...
RUN pnpm --filter @kampi/game-penalty-app... build

FROM nginx:1.27-alpine AS runner
COPY --from=build /app/apps/game-penalty/dist /usr/share/nginx/html
COPY apps/game-penalty/nginx.conf /etc/nginx/templates/default.conf
COPY scripts/nginx-foreground.sh /nginx-foreground.sh
RUN chmod +x /nginx-foreground.sh
EXPOSE 80
CMD ["/nginx-foreground.sh"]

# syntax=docker/dockerfile:1
# Production web image: the Vite build behind nginx with the security headers.
#   docker build -f deploy/web.Dockerfile -t campuslink-web .
# Listens on 8080 behind the load balancer, which terminates TLS and routes /api/* to the API
# (docs/deployment.md). For a single host with TLS in nginx, use deploy/nginx/campuslink.conf.
FROM mirror.gcr.io/library/node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @campuslink/web...
COPY packages/shared packages/shared
COPY deploy/nginx deploy/nginx
COPY apps/web apps/web
RUN pnpm --filter @campuslink/shared build && pnpm --filter @campuslink/web build

FROM mirror.gcr.io/library/nginx:1.28-alpine
COPY deploy/nginx/security-headers.conf /etc/nginx/snippets/campuslink-security-headers.conf
COPY deploy/nginx/static.conf /etc/nginx/snippets/campuslink-static.conf
COPY deploy/nginx/web-container.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /srv/campuslink/web
EXPOSE 8080

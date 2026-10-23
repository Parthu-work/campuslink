# syntax=docker/dockerfile:1
# Production API image. Build from the repository root:
#   docker build -f deploy/api.Dockerfile -t campuslink-api .
FROM mirror.gcr.io/library/node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @campuslink/api... --ignore-scripts=false
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @campuslink/shared build \
  && pnpm --filter @campuslink/api build \
  && pnpm --filter @campuslink/api deploy --prod --legacy /out

FROM mirror.gcr.io/library/node:22-slim
ENV NODE_ENV=production
# The HTTP API only: background jobs (study processing with ffmpeg and Tesseract, embeddings,
# notifications, ingestion) run in the worker image (deploy/worker.Dockerfile), so this image has
# no media tools. Run it with PROCESS_ROLE=api next to at least one worker.
ENV PROCESS_ROLE=api
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]

# syntax=docker/dockerfile:1
# Background worker image: the same build as deploy/api.Dockerfile (keep the build stage in step),
# plus the tools study processing needs. Build from the repository root:
#   docker build -f deploy/worker.Dockerfile -t campuslink-worker .
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
# Study material processing (MEDIA_TOOLS=auto, OCR_PROVIDER=auto): ffmpeg and ffprobe for video
# length, poster frames and audio; pdftoppm and Tesseract (English and Telugu) for scanned pages.
# Whisper runs as its own service (WHISPER_URL), never in this image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg poppler-utils tesseract-ocr tesseract-ocr-eng tesseract-ocr-tel \
  && rm -rf /var/lib/apt/lists/*
ENV PROCESS_ROLE=worker
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
# Health and readiness only; the worker serves no API.
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/v1/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]

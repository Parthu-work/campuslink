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
# Study material processing (MEDIA_TOOLS=auto, OCR_PROVIDER=auto): ffmpeg and ffprobe for video
# length, poster frames and audio; pdftoppm and Tesseract (English and Telugu) for scanned pages.
# Build with --build-arg WITH_MEDIA_TOOLS=false for a smaller image without them.
ARG WITH_MEDIA_TOOLS=true
RUN if [ "$WITH_MEDIA_TOOLS" = "true" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends ffmpeg poppler-utils tesseract-ocr tesseract-ocr-eng tesseract-ocr-tel \
      && rm -rf /var/lib/apt/lists/*; \
    fi
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]

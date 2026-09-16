# syntax=docker/dockerfile:1.7
# Build context is the monorepo root:  docker build -f apps/api/Dockerfile .

FROM node:22-alpine AS build
RUN npm install -g pnpm@9.15.4
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm -r build \
 && pnpm --filter @ams/api --prod deploy /out

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
RUN mkdir -p /app/data/spool && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/healthz > /dev/null || exit 1
CMD ["node", "dist/index.js"]

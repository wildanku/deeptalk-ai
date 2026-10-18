# syntax=docker/dockerfile:1
# Cloud Run image for the gateway. Migrations are NOT run here — the pipeline runs
# `prisma migrate deploy` as a separate step before traffic is shifted (02 §11).

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm exec prisma generate && pnpm run build

# Migration image: run as a Cloud Run Job (`prisma migrate deploy`) before traffic shifts.
FROM base AS migrate
COPY package.json pnpm-lock.yaml prisma.config.ts ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY prisma ./prisma
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:24-slim AS runtime
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 8080
CMD ["node", "dist/main"]

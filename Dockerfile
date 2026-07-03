ARG NODE_VERSION=20-alpine
ARG PNPM_VERSION=9.0.0


# ----- builder: 在容器内完成 install + build -----
FROM node:${NODE_VERSION} AS builder
ARG PNPM_VERSION
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    APP_ENV=PROD
WORKDIR /app

RUN apk add --no-cache bash \
 && corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate

COPY . .

RUN pnpm install --frozen-lockfile \
 && SKIP_BUILD_INSTALL=1 pnpm build


# ----- runner: 仅保留运行时所需文件 -----
FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production \
    APP_ENV=PROD \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=5000
WORKDIR /app

RUN addgroup -g 1001 -S nodejs \
 && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist

USER nextjs
EXPOSE 5000
CMD ["node", "dist/server.js"]

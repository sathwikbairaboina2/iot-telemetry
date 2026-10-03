FROM node:24-bookworm-slim
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm -r --filter "!@iot-telemetry/infra" run build
ENV NODE_ENV=production

FROM mcr.microsoft.com/playwright:v1.63.0-noble
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

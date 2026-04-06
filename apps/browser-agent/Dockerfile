FROM node:22-alpine AS builder
WORKDIR /app

# Copiar configs do monorepo
COPY package*.json turbo.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/browser-agent/ ./apps/browser-agent/

# Instalar dependências
RUN npm ci

# Build com Turborepo
RUN npx turbo build --filter=@payjarvis/browser-agent...

# ─── Production Stage ───
FROM node:22-alpine
WORKDIR /app

COPY --from=builder /app/apps/browser-agent/dist ./dist
COPY --from=builder /app/apps/browser-agent/package.json .
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3003
CMD ["node", "dist/server.js"]

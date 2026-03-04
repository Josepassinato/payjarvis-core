FROM node:22-alpine AS builder
WORKDIR /app

# Copiar configs do monorepo
COPY package*.json turbo.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/rules-engine/ ./apps/rules-engine/

# Instalar dependências
RUN npm ci

# Gerar Prisma Client
RUN npx prisma generate --schema=packages/database/prisma/schema.prisma

# Build com Turborepo
RUN npx turbo build --filter=@payjarvis/rules-engine...

# ─── Production Stage ───
FROM node:22-alpine
WORKDIR /app

COPY --from=builder /app/apps/rules-engine/dist ./dist
COPY --from=builder /app/apps/rules-engine/package.json .
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/database/prisma ./prisma

EXPOSE 3002
CMD ["node", "dist/server.js"]

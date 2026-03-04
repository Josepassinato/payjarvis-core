FROM node:22-alpine AS builder
WORKDIR /app

# Copiar configs do monorepo
COPY package*.json turbo.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

# Instalar dependências
RUN npm ci

# Gerar Prisma Client
RUN npx prisma generate --schema=packages/database/prisma/schema.prisma

# Build com Turborepo
RUN npx turbo build --filter=@payjarvis/api...

# ─── Production Stage ───
FROM node:22-alpine
WORKDIR /app

COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json .
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/database/prisma ./prisma

EXPOSE 3001
CMD ["node", "dist/server.js"]

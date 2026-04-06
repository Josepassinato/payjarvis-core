FROM node:22-alpine AS builder
WORKDIR /app

# Copiar configs do monorepo
COPY package*.json turbo.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/admin/ ./apps/admin/

# Instalar dependências
RUN npm ci

# Build com Turborepo (Next.js standalone)
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN npx turbo build --filter=admin...

# ─── Production Stage ───
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copiar standalone output do Next.js
COPY --from=builder /app/apps/admin/.next/standalone ./
COPY --from=builder /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=builder /app/apps/admin/public ./apps/admin/public

EXPOSE 3005
CMD ["node", "apps/admin/server.js"]

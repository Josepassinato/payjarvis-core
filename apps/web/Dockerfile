FROM node:22-alpine AS builder
WORKDIR /app

# Copiar configs do monorepo
COPY package*.json turbo.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/

# Instalar dependências
RUN npm ci

# Build com Turborepo (Next.js standalone)
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_placeholder
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}

RUN npx turbo build --filter=@payjarvis/web...

# ─── Production Stage ───
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copiar standalone output do Next.js
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]

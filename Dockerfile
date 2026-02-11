FROM node:20-slim AS base

FROM base AS deps
WORKDIR /app

# Install build tools for native modules (python3, make, g++) - required for better-sqlite3 build from source
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Install deps and rebuild better-sqlite3 from source to ensure binary matches Node version
RUN npm ci && npm rebuild better-sqlite3 --build-from-source

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV production

# Install only runtime deps (openssl)
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

COPY --from=builder /app/prisma ./prisma
# Copy the REBUILT native modules (better-sqlite3) explicitly
COPY --from=builder /app/node_modules ./node_modules

USER nextjs

EXPOSE 3000
ENV PORT 3000

CMD ["node", "server.js"]

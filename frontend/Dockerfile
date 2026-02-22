FROM node:20-alpine AS builder
WORKDIR /app

# Required for Next.js telemetry disable and build optimalization
ENV NEXT_TELEMETRY_DISABLED 1

COPY package*.json ./
RUN npm install

COPY . .

# Build Next.js app
RUN npm run build

# Production stage
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

# Don't run production as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

# Expose Next default port
EXPOSE 3001

CMD ["node", "server.js"]

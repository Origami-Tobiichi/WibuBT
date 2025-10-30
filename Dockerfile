# Multi-stage build untuk size yang lebih kecil
FROM node:lts-bullseye AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Final stage
FROM node:lts-bullseye-slim

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y \
    ffmpeg \
    imagemagick \
    webp && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built dependencies from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY . .

EXPOSE 8000

# Health check untuk platform cloud
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["npm", "start"]

# Multi-stage build
FROM node:lts-bullseye AS builder

WORKDIR /app
COPY package*.json ./

# Gunakan npm install jika package-lock.json tidak ada
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

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

CMD ["npm", "start"]

#########################
# 1. Builder stage
#########################
FROM node:22-slim AS builder

WORKDIR /app

# Install system deps
RUN apt-get update && \
    apt-get install -y python3 build-essential && \
    ln -s /usr/bin/python3 /usr/bin/python && \
    rm -rf /var/lib/apt/lists/*

# Copy package files first (makes Docker cache smarter)
COPY package*.json ./

# Install all dependencies (dev + prod)
RUN npm ci

# Copy source code
COPY . .

#########################
# 2. Production stage
#########################
FROM node:22-slim AS production

WORKDIR /app

# Install only runtime dependencies
RUN apt-get update && \
    apt-get install -y ffmpeg libsodium23 python3 && \
    ln -s /usr/bin/python3 /usr/bin/python && \
    rm -rf /var/lib/apt/lists/*

# Create a lightweight non-root user
RUN useradd -m bot
USER bot

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy bot files
COPY --from=builder /app .

# Use production mode
ENV NODE_ENV=production

CMD ["npm", "start"]

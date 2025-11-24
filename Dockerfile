##########################################
# 1. Builder Stage
##########################################
FROM node:22-slim AS builder

WORKDIR /app

# Install python & build tools for certain npm packages
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 build-essential && \
    ln -s /usr/bin/python3 /usr/bin/python && \
    rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install full dependencies
RUN npm ci

# Copy entire project
COPY . .


##########################################
# 2. Production Stage
##########################################
FROM node:22-slim AS production

WORKDIR /app

# Install minimal runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg libsodium23 python3 ca-certificates && \
    ln -s /usr/bin/python3 /usr/bin/python && \
    rm -rf /var/lib/apt/lists/*

# Create a non-root user (auto UID)
RUN useradd -m bot

# Create required writable directories
RUN mkdir -p /app/uploads /app/tmp /app/cookies && \
    chown -R bot:bot /app

# Switch to non-root user
USER bot

# Copy node_modules and source from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app ./

# Production env
ENV NODE_ENV=production

CMD ["npm", "start"]

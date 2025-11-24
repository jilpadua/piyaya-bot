##############################
# 1. Builder Stage
##############################
FROM node:22-slim AS builder

WORKDIR /app

# Install build tools required for some NPM modules
RUN apt-get update && \
    apt-get install -y python3 ffmpeg build-essential && \
    ln -s /usr/bin/python3 /usr/bin/python && \
    rm -rf /var/lib/apt/lists/*

# Copy package files first
COPY package*.json ./

# Install deps (dev + prod)
ENV DISABLE_DAVE=1
RUN npm install @snazzah/davey && npm ci

# Copy source
COPY . .

##############################
# 2. Production Stage
##############################
FROM node:22-slim AS production

WORKDIR /app

# Install only tools needed at runtime
RUN apt-get update && \
    apt-get install -y ffmpeg python3 && \
    ln -s /usr/bin/python3 /usr/bin/python && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m bot
USER bot

# Copy built app
COPY --from=builder /app /app

ENV NODE_ENV=production
ENV DISABLE_DAVE=1

CMD ["npm", "start"]

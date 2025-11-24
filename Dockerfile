FROM node:22-slim

# Install required system deps for voice & opus
RUN apt-get update && \
    apt-get install -y python3 ffmpeg libsodium23 build-essential && \
    ln -s /usr/bin/python3 /usr/bin/python && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only package files first
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy rest of the project
COPY . .

CMD [ "npm", "start" ]
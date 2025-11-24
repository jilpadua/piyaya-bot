# Use official Node 18 base image
FROM node:18

# Install python (required for yt-dlp-exec)
RUN apt-get update && \
    apt-get install -y python3 && \
    ln -s /usr/bin/python3 /usr/bin/python

# Create working directory
WORKDIR /app

# Copy package.json + lock file first (better caching)
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of your bot files
COPY . .

# Expose nothing (discord bots don't listen on a port)
CMD ["npm", "start"]

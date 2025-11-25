# Piyaya Bot (Optimized)


This repository contains an optimized Discord music bot configured to:


- Use YouTube Data API (search) — reliable on hosted platforms
- Use `yt-dlp` for audio streaming
- Use `@discordjs/voice` for audio playback
- Docker-ready with FFmpeg and required libs


## Environment
Create a `.env` file with the following variables:

DISCORD_TOKEN=your_discord_bot_token CLIENT_ID=your_client_id YT_API_KEY=your_youtube_data_api_key
CLIEND_ID=your_discord_app_id

## Files
- `index.js` — bot entrypoint and command handler
- `commands/music.js` — music commands and player
- `Dockerfile` — optimized image for production


## Run locally
1. Install deps: `npm ci`
2. Create `.env` (see above)
3. Run: `node index.js`


## Docker
Build:


```bash
docker build -t piyaya-bot:latest .

Run (locally):

docker run -d --name piyaya-bot --env-file .env piyaya-bot:latest

On Railway: set environment variables in the project settings and deploy the image or push to registry.

Notes:

Using node:20-slim gives newer Node (some @discordjs/voice versions require Node >=22 — but v0.19 works with Node 18+. If you want Node 22+, replace base with node:22-slim.)

FFmpeg installed in image so audio streaming works.

Deployment notes & tips

Railway: add the three env variables via the Railway project settings (DISCORD_TOKEN, CLIENT_ID, YT_API_KEY). Restart deployment after changing env.

YouTube quota: keep an eye on your quota usage for the Data API. Searching consumes quota units.

yt-dlp behavior: we use the YouTube Data API for search and yt-dlp only to stream audio. This avoids bot-blocking issues on shared hosts.

Optional improvements: add a skip command, pause/resume, better error messages, now-playing embeds, and a persistent queue store (e.g., Redis) if you want cross-restart queues.
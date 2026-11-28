FROM ghcr.io/lavalink-devs/lavalink:4.2.2 AS lavalink

FROM node:24-bookworm-slim AS build
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/install-yt-dlp.sh ./scripts/
RUN bash scripts/install-yt-dlp.sh

COPY music-node/application.yml music-node/install-plugins.sh music-node/plugins.sha256 ./music-node/
RUN cd music-node && sh install-plugins.sh

FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg openjdk-17-jre-headless tini \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -o node -g node /app/music-node/logs
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/.tools/yt-dlp ./.tools/yt-dlp
COPY --from=lavalink --chown=node:node /opt/Lavalink/Lavalink.jar ./music-node/Lavalink.jar
COPY --from=build --chown=node:node /build/music-node/plugins ./music-node/plugins
COPY --chown=node:node music-node/application.yml ./music-node/
COPY package.json ./
COPY src/ ./src/
COPY scripts/start-render.js ./scripts/

ENV NODE_ENV=production
USER node
RUN java -version && python3 --version && ffmpeg -hide_banner -version && ./.tools/yt-dlp --version
EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "scripts/start-render.js"]

FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV _JAVA_OPTIONS="-Xms128m -Xmx768m"

RUN apt-get update \
    && apt-get install -y --no-install-recommends openjdk-17-jre-headless curl ca-certificates bash \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

ARG LAVALINK_VERSION=4.2.2
RUN curl -fsSL "https://github.com/lavalink-devs/Lavalink/releases/download/${LAVALINK_VERSION}/Lavalink.jar" -o /app/Lavalink.jar

RUN mkdir -p /app/data
EXPOSE 10000
CMD ["bash", "/app/start.sh"]

FROM alpine:3.24 AS plugins

RUN apk add --no-cache ca-certificates curl
WORKDIR /build
COPY application.yml install-plugins.sh plugins.sha256 ./
RUN sh install-plugins.sh

FROM ghcr.io/lavalink-devs/lavalink:4.2.2

ENV SERVER_ADDRESS=0.0.0.0 \
    SERVER_PORT=10000 \
    SPRING_PROFILES_ACTIVE=render

COPY application.yml /opt/Lavalink/application.yml
COPY --from=plugins --chown=322:322 /build/plugins /opt/Lavalink/plugins

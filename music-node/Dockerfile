FROM alpine:3.24 AS plugins

RUN apk add --no-cache ca-certificates curl
WORKDIR /build
COPY application.yml plugins.sha256 ./
RUN set -eu; \
    mkdir plugins; \
    awk '$1 == "-" && $2 == "dependency:" { split($3, coordinate, ":"); gsub(/\./, "/", coordinate[1]); print coordinate[1] "/" coordinate[2] "/" coordinate[3] "/" coordinate[2] "-" coordinate[3] ".jar" }' application.yml > plugin-paths; \
    test -s plugin-paths; \
    test "$(wc -l < plugin-paths)" -eq "$(wc -l < plugins.sha256)"; \
    while IFS= read -r path; do \
        curl -fsSL --retry 3 --max-time 120 "https://maven.lavalink.dev/releases/$path" -o "plugins/${path##*/}"; \
    done < plugin-paths; \
    cd plugins; \
    sha256sum -c ../plugins.sha256

FROM ghcr.io/lavalink-devs/lavalink:4.2.2

ENV SERVER_ADDRESS=0.0.0.0 \
    SERVER_PORT=10000 \
    SPRING_PROFILES_ACTIVE=render

COPY application.yml /opt/Lavalink/application.yml
COPY --from=plugins --chown=322:322 /build/plugins /opt/Lavalink/plugins

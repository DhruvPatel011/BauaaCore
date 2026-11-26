#!/bin/sh
set -eu

mkdir -p plugins
awk '$1 == "-" && $2 == "dependency:" {
    split($3, coordinate, ":")
    gsub(/\./, "/", coordinate[1])
    print coordinate[1] "/" coordinate[2] "/" coordinate[3] "/" coordinate[2] "-" coordinate[3] ".jar"
}' application.yml > plugin-paths

test -s plugin-paths
test "$(wc -l < plugin-paths)" -eq "$(wc -l < plugins.sha256)"
while IFS= read -r path; do
    curl -fsSL --retry 3 --max-time 120 "https://maven.lavalink.dev/releases/$path" -o "plugins/${path##*/}"
done < plugin-paths

cd plugins
sha256sum -c ../plugins.sha256

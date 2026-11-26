#!/usr/bin/env bash
set -euo pipefail

release=2026.11.23
asset=yt-dlp_linux
release_url="https://github.com/yt-dlp/yt-dlp/releases/download/$release"
download_dir=$(mktemp -d)
trap 'rm -f -- "$download_dir/$asset" "$download_dir/SHA2-256SUMS"; rmdir -- "$download_dir"' EXIT

curl -fsSL --retry 3 --max-time 120 "$release_url/$asset" -o "$download_dir/$asset"
curl -fsSL --retry 3 --max-time 120 "$release_url/SHA2-256SUMS" -o "$download_dir/SHA2-256SUMS"
(
    cd "$download_dir"
    awk -v asset="$asset" '$2 == asset || $2 == "*" asset' SHA2-256SUMS | sha256sum --check --strict
)

mkdir -p .tools
install -m 755 "$download_dir/$asset" .tools/yt-dlp
.tools/yt-dlp --version

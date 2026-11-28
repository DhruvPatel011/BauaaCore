#!/usr/bin/env bash
set -euo pipefail

release=2026.11.23
asset=yt-dlp
release_url="https://github.com/yt-dlp/yt-dlp/releases/download/$release"
download_dir=$(mktemp -d)
trap 'rm -rf -- "$download_dir"' EXIT

curl -fsSL --retry 3 --max-time 120 "$release_url/$asset" -o "$download_dir/$asset"
curl -fsSL --retry 3 --max-time 120 "$release_url/SHA2-256SUMS" -o "$download_dir/SHA2-256SUMS"
(
    cd "$download_dir"
    awk -v asset="$asset" '$2 == asset || $2 == "*" asset' SHA2-256SUMS | sha256sum --check --strict
)

mkdir -p .tools
# Prepare the verified Unix distribution once. On a CPU-limited host this
# avoids decompressing and compiling the Python modules for each invocation.
python3 -m zipfile -e "$download_dir/$asset" "$download_dir/package"
python3 -m compileall -q -b "$download_dir/package"
python3 -m zipapp "$download_dir/package" -p '/usr/bin/env python3' -o "$download_dir/yt-dlp-runtime"
install -m 755 "$download_dir/yt-dlp-runtime" .tools/yt-dlp
.tools/yt-dlp --version

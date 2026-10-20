#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# cover.jpg from cover.svg: exactly 800 x 534, JPEG, under 150 KB (the store
# rules). Needs Inkscape and ImageMagick. Run from the repository root.
# -----------------------------------------------------------------------------
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
inkscape "$repo/cover.svg" --export-type=png --export-filename="$work/cover.png" \
  --export-width=800 --export-height=534 >/dev/null 2>&1
magick "$work/cover.png" -background white -flatten -strip -quality 88 "$repo/cover.jpg"
identify -format '%wx%h %b\n' "$repo/cover.jpg"

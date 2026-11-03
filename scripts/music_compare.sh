#!/usr/bin/env bash
# Run the reference analysis (scripts/music_ref_analysis.py) on our own renders, so the score can be
# compared with the references on the same measures. Usage: bash scripts/music_compare.sh [prefix...]
set -e
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
for pre in "${@:-music_before_ music_after_}"; do
  for f in screenshots/audio/${pre}*.wav; do
    ffmpeg -loglevel error -y -i "$f" -ac 1 -ar 22050 "$TMP/$(basename "$f")"
  done
done
mkdir -p screenshots/music_ours
PYTHONIOENCODING=utf-8 python scripts/music_ref_analysis.py "$TMP" screenshots/music_ours 2>&1 | grep -v -i warn
rm -rf "$TMP"

#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${1:-/Users/mac/gamelab61315}"
TARGET_DIR="$ROOT_DIR/static/apply"

if [[ ! -f "$SOURCE_DIR/package.json" ]]; then
  echo "Recruitment app not found at: $SOURCE_DIR" >&2
  exit 1
fi

pushd "$SOURCE_DIR" >/dev/null
if [[ ! -d node_modules ]]; then
  npm install
fi
npm run build
popd >/dev/null

rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"
cp -R "$SOURCE_DIR/dist/." "$TARGET_DIR/"

echo "Synced recruitment app to $TARGET_DIR"

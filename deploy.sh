#!/usr/bin/env bash
set -euo pipefail

SOURCE_FILE="./ProcessMasters.js"
DEST_DIR="C:/Program Files/Pixinsight/src/scripts/ktf"

if [[ ! -f "$SOURCE_FILE" ]]; then
  echo "Error: source file not found: $SOURCE_FILE"
  exit 1
fi

cp $SOURCE_FILE "$DEST_DIR/ProcessMasters.js"

ls -la "$DEST_DIR"
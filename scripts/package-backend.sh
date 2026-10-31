#!/bin/bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR/backend"

echo "[PulseWatch] Packaging backend application into zip..."
rm -f "$DIR/infra/backend_package.zip"
zip -r "$DIR/infra/backend_package.zip" app.py worker.py requirements.txt

echo "[PulseWatch] Backend package created at infra/backend_package.zip"

#!/usr/bin/env bash
# NovaPOS bazasini zaxiralash (ishlab turgan paytda ham xavfsiz — SQLite online backup)
# Har kuni soat 03:00 da (crontab -e):
#   0 3 * * * /opt/novapos/deploy/backup.sh >> /var/log/novapos-backup.log 2>&1
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/novapos}"
DB="${DB:-$APP_DIR/novapos.db}"
DEST="${DEST:-$APP_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"

mkdir -p "$DEST"
STAMP="$(date +%Y-%m-%d_%H%M)"
OUT="$DEST/novapos_$STAMP.db"

"$APP_DIR/venv/bin/python" - "$DB" "$OUT" <<'PY'
import sqlite3, sys
src = sqlite3.connect(sys.argv[1]); dst = sqlite3.connect(sys.argv[2])
src.backup(dst); dst.close(); src.close()
PY
gzip -f "$OUT"
# Yuklangan to'lov cheklari ham
tar -czf "$DEST/uploads_$STAMP.tar.gz" -C "$APP_DIR/webapp/static" uploads 2>/dev/null || true

find "$DEST" -name 'novapos_*.db.gz'   -mtime +"$KEEP_DAYS" -delete
find "$DEST" -name 'uploads_*.tar.gz'  -mtime +"$KEEP_DAYS" -delete
echo "$(date '+%F %T') OK: $OUT.gz"

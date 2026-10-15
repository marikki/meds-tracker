#!/usr/bin/env bash
# Консистентний бекап SQLite через backup API (просто копіювати файл у режимі WAL небезпечно).
# Cron на VPS:  15 3 * * *  /path/to/meds-tracker/scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
STAMP=$(date +%F)
docker exec meds-tracker node -e "
  const Db = require('better-sqlite3');
  require('fs').mkdirSync('/app/data/backups', { recursive: true });
  new Db('/app/data/meds.db', { readonly: true })
    .backup('/app/data/backups/meds-${STAMP}.db')
    .then(() => console.log('ok'), (e) => { console.error(e); process.exit(1); });
"
# Залишаємо 30 останніх
ls -1t data/backups/meds-*.db | tail -n +31 | xargs -r rm --
# TODO: копія за межі VPS (rclone на Google Drive тощо)

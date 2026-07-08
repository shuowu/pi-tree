#!/bin/sh
# Nightly backup for pi-tree sqld databases.
#
# Runs inside an alpine container (see docker-compose.sqld.yml) with:
#   /data     → sqld volume root (main-data/, news-data/)
#   /backups  → backup destination
#
# Uses the SQLite backup API (`.backup`), which is safe to run against a
# database that sqld is actively writing. The /data mount must be read-write:
# SQLite needs to touch the -shm file to take read locks on a WAL database.

KEEP=14        # dated backups to keep per database
INTERVAL=86400 # seconds between runs

while true; do
  for db in main news; do
    src="/data/${db}-data/iku.db/dbs/default/data"
    out="/backups/${db}-$(date +%Y-%m-%d).db"
    if [ -f "$src" ]; then
      rm -f "$out"
      if sqlite3 "$src" ".backup '${out}'"; then
        echo "[backup] $(date '+%F %T') ${out} integrity=$(sqlite3 "$out" 'PRAGMA integrity_check;')"
      else
        echo "[backup] $(date '+%F %T') FAILED: ${src}" >&2
      fi
    fi
    # Retention: keep the newest $KEEP dated files per database.
    ls -1t /backups/"${db}"-*.db 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r f; do
      rm -f "$f"
      echo "[backup] pruned $f"
    done
  done
  sleep "$INTERVAL"
done

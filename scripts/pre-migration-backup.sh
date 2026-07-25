#!/bin/sh
set -eu

if [ "${PRE_MIGRATION_BACKUP_ENABLED:-false}" != "true" ]; then
	echo "pre-migration backup disabled"
	exit 0
fi

: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"

backup_dir="${PRE_MIGRATION_BACKUP_DIR:-/backups}"
mkdir -p "$backup_dir"

sanitize() {
	printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '-'
}

database="$(sanitize "$PGDATABASE")"
timestamp="$(date -u '+%Y-%m-%dT%H-%M-%SZ')"
ref="$(sanitize "${DEPLOY_REF_NAME:-main}")"
commit="$(sanitize "${DEPLOY_COMMIT_SHA:-unknown}")"
short_commit="$(printf '%s' "$commit" | cut -c 1-12)"
backup_file="${backup_dir}/${database}-${timestamp}-${ref}-${short_commit}.dump"

echo "creating pre-migration backup: ${backup_file}"
pg_dump --format=custom --file="$backup_file"

if [ ! -s "$backup_file" ]; then
	echo "backup file is missing or empty: ${backup_file}" >&2
	exit 1
fi

pg_restore --list "$backup_file" >/dev/null

set -- $(ls -1t "${backup_dir}/${database}-"*.dump 2>/dev/null || true)
index=0
for file do
	index=$((index + 1))
	if [ "$index" -le 2 ]; then
		continue
	fi
	rm -f "$file"
done

echo "pre-migration backup verified"

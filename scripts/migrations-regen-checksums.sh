#!/usr/bin/env bash
# Regenerate sha384 checksum files for all SQL migrations.
#
# Run this when you INTENTIONALLY add or modify a migration. Modifying an
# already-applied migration is rare and dangerous (it breaks users who already
# applied the previous content) — review carefully before committing.
#
# Usage: bash scripts/migrations-regen-checksums.sh

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG_DIR="$REPO_ROOT/frontend/src-tauri/migrations"

if [ ! -d "$MIG_DIR" ]; then
    echo "❌ Migration directory not found: $MIG_DIR"
    exit 1
fi

cd "$MIG_DIR"

count=0
for f in *.sql; do
    if [ ! -f "$f" ]; then
        echo "⚠️  No .sql files found in $MIG_DIR"
        exit 1
    fi
    sha384sum "$f" | awk '{print $1}' > "$f.sha384"
    echo "✓ $f.sha384"
    count=$((count + 1))
done

echo ""
echo "✅ Regenerated $count checksum files"
echo ""
echo "Next: review the diff, then 'git add *.sha384' and commit alongside"
echo "the migration changes for a unified review trail."

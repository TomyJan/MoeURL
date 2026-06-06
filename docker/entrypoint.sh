#!/bin/sh
set -eu

if [ -z "${MOEURL_DATABASE_URL:-}" ]; then
  echo "MOEURL_DATABASE_URL is required" >&2
  exit 1
fi

/app/goose -dir /app/migrations postgres "$MOEURL_DATABASE_URL" up
exec /app/moeurl

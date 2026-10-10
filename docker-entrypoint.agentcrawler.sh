#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/agenthub-py/bin:/usr/lib/postgresql/15/bin:${PATH}"
export PGDATA="${PGDATA:-/var/lib/postgresql/15/main}"

mkdir -p "$(dirname "$PGDATA")" /var/run/postgresql
chown -R postgres:postgres /var/lib/postgresql /var/run/postgresql

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  install -d -o postgres -g postgres "$PGDATA"
  su postgres -c "initdb -D '$PGDATA' --encoding=UTF8 --locale=C.UTF-8"
  {
    echo "listen_addresses = '127.0.0.1'"
    echo "port = 5432"
  } >> "$PGDATA/postgresql.conf"
  {
    echo "local all all trust"
    echo "host all all 127.0.0.1/32 md5"
  } >> "$PGDATA/pg_hba.conf"
fi

su postgres -c "pg_ctl -D '$PGDATA' -l /tmp/agentcrawler-postgres.log start"

for _ in $(seq 1 60); do
  if pg_isready -h 127.0.0.1 -p 5432 -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

psql -h 127.0.0.1 -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='opencrow'" | grep -q 1 \
  || psql -h 127.0.0.1 -U postgres -c "CREATE ROLE opencrow WITH LOGIN PASSWORD 'opencrow' SUPERUSER"
psql -h 127.0.0.1 -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='opencrow'" | grep -q 1 \
  || psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE opencrow OWNER opencrow"

exec su node -s /bin/bash -c "cd /app && exec bun run start"

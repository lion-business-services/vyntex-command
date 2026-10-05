#!/usr/bin/env bash
# Throwaway local PostgreSQL for the server tests and for `npm run dev:stack`. Nothing here talks to Supabase.
# It follows supabase/tests/run_local.sh (same stand-ins, same non-superuser migration role) but leaves the server
# running so the test double of the Supabase HTTP surface (scripts/dev-supabase.mjs) can use it.
#
#   bash tests/server/pg_local.sh start     start, create the database, apply the migrations and the seed
#   bash tests/server/pg_local.sh stop      stop the server
#   bash tests/server/pg_local.sh env       print the settings scripts/dev-supabase.mjs needs
#
# Settings (environment variables):
#   PGBIN            folder with initdb, pg_ctl, psql        default /usr/lib/postgresql/16/bin
#   PGTEST_DIR       throwaway data folder                   default /tmp/vx-pg-server
#   PGTEST_USER      OS user that runs the server when started as root   default postgres
#   MIGRATIONS_MODE  "isolated" (default): migrations 0001 to 0009, the server core range 0020 to 0029, and a small
#                    stand-in for the gateway functions (tests/server/sql/stub_gateway.sql), copied to a temporary
#                    folder. This is what the server tests use, so they do not depend on files other people are still writing.
#                    "all": every file in supabase/migrations, in order (what `npm run dev:stack` uses).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
if [ ! -x "$PGBIN/initdb" ]; then PGBIN="$(dirname "$(command -v initdb || true)")"; fi
if [ ! -x "$PGBIN/initdb" ] || [ ! -x "$PGBIN/pg_ctl" ] || [ ! -x "$PGBIN/psql" ]; then
  echo "PostgreSQL 15 or newer is required (initdb, pg_ctl, psql). Set PGBIN to the folder that holds them." >&2
  exit 2
fi

dir="${PGTEST_DIR:-/tmp/vx-pg-server}"
data="$dir/data"
sock="$dir/sock"
log="$dir/server.log"
db="vyntex_server"
admin="supabase_admin"
os_user="${PGTEST_USER:-postgres}"
mode="${MIGRATIONS_MODE:-isolated}"

as_server_user() { if [ "$(id -u)" -eq 0 ]; then runuser -u "$os_user" -- "$@"; else "$@"; fi; }
psql_as() { local role="$1"; shift; PGOPTIONS="-c client_min_messages=warning" "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$sock" -U "$role" "$@"; }
stop_server() { if [ -f "$data/postmaster.pid" ]; then as_server_user "$PGBIN/pg_ctl" -D "$data" -m fast -w stop >/dev/null 2>&1 || true; fi; }

case "${1:-start}" in
  stop)
    stop_server
    echo "stopped"
    ;;
  env)
    echo "PSQL=$PGBIN/psql"
    echo "PGHOST=$sock"
    echo "PGDATABASE=$db"
    ;;
  start)
    stop_server
    rm -rf "$dir"
    mkdir -p "$dir" "$sock"
    if [ "$(id -u)" -eq 0 ]; then chown -R "$os_user" "$dir"; fi
    chmod 755 "$dir" "$sock"
    as_server_user "$PGBIN/initdb" -D "$data" -U "$admin" --auth=trust --encoding=UTF8 --locale=C >/dev/null
    as_server_user "$PGBIN/pg_ctl" -D "$data" -l "$log" -w \
      -o "-c listen_addresses='' -c unix_socket_directories='$sock' -c fsync=off -c max_connections=60" start >/dev/null
    psql_as "$admin" -d postgres -c "create database $db"
    psql_as "$admin" -d "$db" -f "$root/supabase/tests/setup_local.sql"

    work="$dir/migrations"
    mkdir -p "$work"
    if [ "$mode" = "all" ]; then
      cp "$root"/supabase/migrations/*.sql "$work/"
    else
      cp "$root"/supabase/migrations/000[1-9]_*.sql "$work/"
      cp "$here/sql/stub_gateway.sql" "$work/0019_stub_gateway.sql"
      cp "$root"/supabase/migrations/002[0-9]_*.sql "$work/"
    fi
    for f in "$work"/*.sql; do
      echo "   $(basename "$f")"
      psql_as postgres -d "$db" -f "$f"
    done
    psql_as postgres -d "$db" -f "$root/supabase/seed.sql"
    # The last server core migration is the lockdown check. Running it again proves it is repeatable.
    psql_as postgres -d "$db" -f "$root"/supabase/migrations/0029_*.sql
    # Local keys, supplied the documented local way (a database setting). Never used anywhere else.
    psql_as "$admin" -d "$db" -c "alter database $db set app.settings.pii_encryption_key = 'local-test-key-0123456789-abcdefghijklmnop'" \
      -c "alter database $db set app.settings.ip_hash_salt = 'local-test-salt-0123456789'"
    echo "ready: $PGBIN/psql -h $sock -U $admin -d $db"
    ;;
  *)
    echo "usage: pg_local.sh start|stop|env" >&2
    exit 2
    ;;
esac

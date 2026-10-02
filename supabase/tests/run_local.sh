#!/usr/bin/env bash
# Local proof of the database rules. Nothing here talks to Supabase or to the internet.
#
#   bash supabase/tests/run_local.sh
#
# What it does:
#   1. starts a throwaway PostgreSQL server (its own data folder, a local socket only, no network port)
#   2. creates a fresh database and the Supabase stand-ins (setup_local.sql)
#   3. applies every file in supabase/migrations in order, then supabase/seed.sql, as the non-superuser role "postgres"
#   4. runs rls_isolation.sql (every assertion raises on failure) and parity.mjs (app code and database agree)
#   5. stops the server
#
# Settings (environment variables):
#   PGBIN        folder with initdb, pg_ctl, psql        default /usr/lib/postgresql/16/bin, else whatever is on PATH
#   PGTEST_DIR   throwaway data folder                   default /tmp/vyntex-pgtest
#   PGTEST_USER  OS user that runs the server when this script is started as root (Postgres refuses to run as root)
#                                                        default postgres
#   KEEP=1       leave the server running afterwards (connect with the psql line printed at the end)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
if [ ! -x "$PGBIN/initdb" ]; then
  PGBIN="$(dirname "$(command -v initdb || true)")"
fi
if [ ! -x "$PGBIN/initdb" ] || [ ! -x "$PGBIN/pg_ctl" ] || [ ! -x "$PGBIN/psql" ]; then
  echo "PostgreSQL 15 or newer is required (initdb, pg_ctl, psql). Set PGBIN to the folder that holds them." >&2
  exit 2
fi

dir="${PGTEST_DIR:-/tmp/vyntex-pgtest}"
data="$dir/data"
sock="$dir/sock"
log="$dir/server.log"
db="vyntex_test"
admin="supabase_admin"
os_user="${PGTEST_USER:-postgres}"

# Postgres will not run as root: hand the server commands to an unprivileged OS user.
as_server_user() {
  if [ "$(id -u)" -eq 0 ]; then runuser -u "$os_user" -- "$@"; else "$@"; fi
}
psql_as() { # psql_as <role> [psql arguments...]
  local role="$1"; shift
  PGOPTIONS="-c client_min_messages=warning" "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$sock" -U "$role" "$@"
}
stop_server() {
  if [ -f "$data/postmaster.pid" ]; then
    as_server_user "$PGBIN/pg_ctl" -D "$data" -m fast -w stop >/dev/null 2>&1 || true
  fi
}

stop_server
rm -rf "$dir"
mkdir -p "$dir" "$sock"
if [ "$(id -u)" -eq 0 ]; then chown -R "$os_user" "$dir"; fi
chmod 755 "$dir" "$sock"

echo "== starting a throwaway PostgreSQL in $dir"
as_server_user "$PGBIN/initdb" -D "$data" -U "$admin" --auth=trust --encoding=UTF8 --locale=C >/dev/null
as_server_user "$PGBIN/pg_ctl" -D "$data" -l "$log" -w \
  -o "-c listen_addresses='' -c unix_socket_directories='$sock' -c fsync=off" start >/dev/null
if [ "${KEEP:-0}" != "1" ]; then trap stop_server EXIT; fi

"$PGBIN/psql" -X -q -h "$sock" -U "$admin" -d postgres -Atc "select 'server: ' || version()"
if ! "$PGBIN/psql" -X -q -h "$sock" -U "$admin" -d postgres -Atc "select 1 from pg_available_extensions where name = 'pgcrypto'" | grep -q 1; then
  echo "pgcrypto is not available in this PostgreSQL installation: the encryption tests cannot run." >&2
  exit 2
fi

psql_as "$admin" -d postgres -c "create database $db"
echo "== Supabase stand-ins (setup_local.sql)"
psql_as "$admin" -d "$db" -f "$here/setup_local.sql"

echo "== migrations, applied as the non-superuser role postgres"
for f in "$root"/supabase/migrations/*.sql; do
  echo "   $(basename "$f")"
  psql_as postgres -d "$db" -f "$f"
done
echo "   seed.sql"
psql_as postgres -d "$db" -f "$root/supabase/seed.sql"
echo "   (again, to prove the seed and the lockdown check are repeatable)"
psql_as postgres -d "$db" -f "$root/supabase/seed.sql"
last="$(ls "$root"/supabase/migrations/*.sql | sort | tail -n 1)"
psql_as postgres -d "$db" -f "$last"

echo "== database tests (rls_isolation.sql)"
psql_as "$admin" -d "$db" -f "$here/rls_isolation.sql"

echo "== parity between the app code and the database (parity.mjs)"
PSQL="$PGBIN/psql" PGHOST="$sock" PGUSER="$admin" PGDATABASE="$db" node "$here/parity.mjs"

echo
echo "ALL DATABASE CHECKS PASSED"
if [ "${KEEP:-0}" = "1" ]; then
  echo "Server left running. Connect with: $PGBIN/psql -h $sock -U $admin -d $db"
fi

#!/usr/bin/env bash
# The database tests, run against a PostgreSQL server that is already running: the postgres:16 service of
# .github/workflows/ci.yml.
#
# It runs supabase/tests/run_local.sh itself, unchanged, so CI can never fall behind the local test. The only
# difference is where the server comes from: run_local.sh starts its own, and here three small stand-ins in
# .github/scripts/pg-service (initdb, pg_ctl, psql) point it at the service instead.
#
# Settings (environment variables):
#   PGHOST, PGPORT   where the service listens (a host name, or a socket folder when trying this locally)
#   PGADMIN          the service's superuser                        default supabase_admin
#   REAL_PSQL        the real psql program                          default: psql on PATH
#
# The service must accept connections without a password. It is a throwaway server with no data, reachable only
# from the job, which is why that is acceptable.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
: "${PGHOST:?PGHOST is not set}"

export SERVICE_PGHOST="$PGHOST" SERVICE_PGPORT="${PGPORT:-5432}" SERVICE_PGADMIN="${PGADMIN:-supabase_admin}"
export REAL_PSQL="${REAL_PSQL:-$(command -v psql)}"
[ -x "$REAL_PSQL" ] || { echo "psql not found. Install the PostgreSQL client tools." >&2; exit 2; }
unset PGHOST PGPORT

echo "database service: $("$here/pg-service/psql" -X -q -U "$SERVICE_PGADMIN" -d postgres -Atc 'select version()')"
PGBIN="$here/pg-service" PGTEST_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/vx-db-tests" bash "$root/supabase/tests/run_local.sh"

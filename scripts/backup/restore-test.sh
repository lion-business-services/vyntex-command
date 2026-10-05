#!/usr/bin/env bash
# Proves, on this computer, that a backup made by backup.sh can be restored by restore.sh. Nothing here talks to
# Supabase or to the internet. The owner's brief, section 61: "Do not claim backups work unless restore is tested."
#
#   bash scripts/backup/restore-test.sh
#
# What it does:
#    1. starts a throwaway PostgreSQL server (its own data folder, a local socket only, no network port),
#       the same way supabase/tests/run_local.sh does
#    2. creates a database, the Supabase stand-ins, and applies every migration in order, then seed.sql
#    3. inserts marker rows (restore-test-markers.sql), including one encrypted tax ID
#    4. records a fingerprint of the database: row count and checksum of every table, and every access rule
#    5. makes a key pair for this run and runs backup.sh
#    6. checks that only encrypted files were written and that the marker text cannot be found in them
#    7. checks that a wrong key and an altered file are both refused
#    8. DROPS the database
#    9. runs restore.sh into a fresh database on the same server and compares the fingerprint,
#       then changes one value and one rule on purpose to prove the comparison would notice
#   10. starts a SECOND, brand new server, restores the roles and the database there, and compares again
#   11. checks that the encrypted tax ID can be read again once the key is supplied, and not without it
#   12. starts a THIRD server prepared like a new Supabase project (the platform's own roles and its "auth" and
#       "storage" tables already there, with the platform's wide default privileges, the product absent) and
#       restores into it: the platform's tables are kept, their rows and the product's policies on them come back,
#       and the product's schemas are restored. This is the shape a restore into Supabase takes.
#   13. stops the servers
#
# Settings (environment variables):
#   PGBIN        folder with initdb, pg_ctl, psql, pg_dump, pg_restore   default /usr/lib/postgresql/16/bin, else PATH
#   PGTEST_DIR   throwaway folder                                       default /tmp/vyntex-restore-test
#   PGTEST_USER  OS user that runs the servers when this script is started as root   default postgres
#   KEEP=1       leave the servers and the files in place afterwards, to look at them
#   MIGRATIONS_DIR   folder of migration files to apply                 default supabase/migrations
#   RESTORE_EVIDENCE_FILE   also write the summary to this file (to keep as a record of the drill)
#
# What this does NOT prove: a restore into a real Supabase project. Supabase manages some schemas itself (auth,
# storage, vault), and that restore has to be tried on a scratch project. See docs/security/backup-and-recovery.md.
set -euo pipefail
umask 077

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
# shellcheck source=scripts/backup/lib.sh
. "$here/lib.sh"

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
if [ ! -x "$PGBIN/initdb" ]; then PGBIN="$(dirname "$(command -v initdb || true)")"; fi
for tool in initdb pg_ctl psql pg_dump pg_dumpall pg_restore; do
  [ -x "$PGBIN/$tool" ] || { echo "PostgreSQL 15 or newer is required ($tool not found). Set PGBIN to the folder that holds it." >&2; exit 2; }
done
export PGBIN
need_tool age "Install it from https://age-encryption.org"
need_tool age-keygen "It is installed together with age."

dir="${PGTEST_DIR:-/tmp/vyntex-restore-test}"
os_user="${PGTEST_USER:-postgres}"
admin="supabase_admin"
src_db="vyntex_restore_src"
dst_db="vyntex_restore_dst"
marker="Restore test company A (sample)"
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

as_server_user() { if [ "$(id -u)" -eq 0 ]; then runuser -u "$os_user" -- "$@"; else "$@"; fi; }
psql_on() { # psql_on <socket folder> <role> [psql arguments...]
  local sock="$1" role="$2"; shift 2
  PGOPTIONS="-c client_min_messages=warning" "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 --no-password -h "$sock" -U "$role" "$@"
}
start_server() { # start_server <name>   (data in $dir/<name>/data, socket in $dir/<name>/sock)
  local base="$dir/$1"
  mkdir -p "$base/sock"
  if [ "$(id -u)" -eq 0 ]; then chown -R "$os_user" "$base"; fi
  chmod 755 "$base" "$base/sock"
  as_server_user "$PGBIN/initdb" -D "$base/data" -U "$admin" --auth=trust --encoding=UTF8 --locale=C >/dev/null
  as_server_user "$PGBIN/pg_ctl" -D "$base/data" -l "$base/server.log" -w \
    -o "-c listen_addresses='' -c unix_socket_directories='$base/sock' -c fsync=off" start >/dev/null
}
stop_server() {
  local base="$dir/$1"
  if [ -f "$base/data/postmaster.pid" ]; then as_server_user "$PGBIN/pg_ctl" -D "$base/data" -m fast -w stop >/dev/null 2>&1 || true; fi
}
finish() {
  local code=$?
  if [ "${KEEP:-0}" = "1" ]; then echo "KEEP=1: servers and files left in $dir"; else stop_server one; stop_server two; stop_server three; rm -rf "$dir"; fi
  if [ $code -ne 0 ]; then echo; echo "RESTORE TEST FAILED"; fi
  exit $code
}
fingerprint() { # fingerprint <socket> <database> <output file>
  psql_on "$1" "$admin" -d "$2" -At -f "$here/fingerprint.sql" > "$3"
}
# Runs a command that must fail. Passes its output through so the reason is visible, indented.
must_fail() { # must_fail <what> <command...>
  local what="$1"; shift
  if "$@" > "$dir/expected-failure.log" 2>&1; then
    echo "   NOT REFUSED: $what" >&2; exit 1
  fi
  echo "   refused, as it must be: $what ($(grep -m1 -E 'error:' "$dir/expected-failure.log" | sed 's/^error: //' | cut -c1-110))"
}

stop_server one; stop_server two; stop_server three
rm -rf "$dir"
mkdir -p "$dir/backups" "$dir/tmp"
chmod 755 "$dir"
trap finish EXIT

note "1. starting a throwaway PostgreSQL in $dir/one"
start_server one
s1="$dir/one/sock"
server_version="$("$PGBIN/psql" -X -q -h "$s1" -U "$admin" -d postgres -Atc 'show server_version')"
echo "   server $server_version"

note "2. database, Supabase stand-ins, migrations, seed"
psql_on "$s1" "$admin" -d postgres -c "create database $src_db"
psql_on "$s1" "$admin" -d "$src_db" -f "$root/supabase/tests/setup_local.sql"
migrations=0
for f in "${MIGRATIONS_DIR:-$root/supabase/migrations}"/*.sql; do
  psql_on "$s1" postgres -d "$src_db" -f "$f" > /dev/null
  migrations=$((migrations + 1))
done
psql_on "$s1" postgres -d "$src_db" -f "$root/supabase/seed.sql" > /dev/null
echo "   $migrations migrations applied as the non-superuser role postgres"

note "3. marker rows"
psql_on "$s1" "$admin" -d "$src_db" -f "$here/restore-test-markers.sql"

note "4. fingerprint of the original"
fingerprint "$s1" "$src_db" "$dir/before.txt"
tables="$(grep -c '^data|' "$dir/before.txt")"
rows="$(grep '^data|' "$dir/before.txt" | awk -F'|' '{ n += $3 } END { print n }')"
rules="$(grep -vc '^data|' "$dir/before.txt")"
echo "   $tables tables, $rows rows, $rules rule lines (policies, privileges, functions, triggers, constraints)"
grep -q "^data|restore_test.awkward|2000|" "$dir/before.txt" || die "the marker table is not in the fingerprint"
[ "$rows" -gt 2000 ] || die "fewer rows than the markers alone: the fingerprint is not reading the tables"

note "5. key pair for this run, then backup.sh"
age-keygen -o "$dir/key.txt" 2> /dev/null
recipient="$(age-keygen -y "$dir/key.txt")"
age-keygen -o "$dir/other-key.txt" 2> /dev/null
BACKUP_LABEL=restore-test BACKUP_DIR="$dir/backups" BACKUP_AGE_RECIPIENT="$recipient" BACKUP_INCLUDE_ROLES=1 \
  PGHOST="$s1" PGUSER="$admin" PGDATABASE="$src_db" bash "$here/backup.sh" | sed 's/^/   /'
backup="$(ls "$dir"/backups/*.dump.age)"
roles="$(ls "$dir"/backups/*.roles.sql.age)"
bytes="$(size_of "$backup")"
sum="$(sha256_of "$backup")"
# A second backup, limited to named schemas: the product's own and the platform's "auth" and "storage". On Supabase
# the database role cannot read every internal schema, so this is the form a backup takes there (step 12).
named_schemas="$(psql_on "$s1" "$admin" -d "$src_db" -Atc "select string_agg(nspname, ' ' order by nspname) from pg_namespace where nspname not in ('pg_catalog', 'information_schema', 'extensions') and nspname !~ '^pg_'")"
BACKUP_LABEL=restore-test-named BACKUP_DIR="$dir/backups-named" BACKUP_AGE_RECIPIENT="$recipient" BACKUP_SCHEMAS="$named_schemas" \
  PGHOST="$s1" PGUSER="$admin" PGDATABASE="$src_db" bash "$here/backup.sh" > /dev/null
backup_named="$(ls "$dir"/backups-named/*.dump.age)"
echo "   second backup, named schemas only ($named_schemas): $(size_of "$backup_named") bytes"

note "6. only encrypted files were written, and the marker text is not readable in them"
unexpected="$(find "$dir/backups" -type f ! -name '*.age' ! -name '*.sha256' ! -name '*.manifest.json' | wc -l | tr -d ' ')"
[ "$unexpected" = "0" ] || die "backup.sh left $unexpected unexpected file(s) in the backup folder"
if grep -aq "$marker" "$backup" || grep -aq "restore-owner-a@example.com" "$backup" || grep -aq "PGDMP" "$backup"; then die "readable content found in the encrypted backup"; fi
head -c 21 "$backup" | grep -q "age-encryption.org/v1" || die "the backup is not an age file"
grep -q '"sha256": "'"$sum"'"' "$dir"/backups/*.manifest.json || die "the manifest does not carry the checksum"
if grep -Eiq 'password|AGE-SECRET-KEY' "$dir"/backups/*.manifest.json; then die "the manifest holds something it must not"; fi
echo "   $(basename "$backup"): $bytes bytes, sha256 $sum"

note "7. a wrong key and an altered file are refused"
common=(PGHOST="$s1" PGUSER="$admin" PGDATABASE=postgres RESTORE_CONFIRM=postgres RESTORE_TMPDIR="$dir/tmp")
must_fail "restore with another key" env "${common[@]}" RESTORE_FILE="$backup" BACKUP_AGE_IDENTITY_FILE="$dir/other-key.txt" bash "$here/restore.sh"
cp "$backup" "$dir/tampered.dump.age"; cp "$backup.sha256" "$dir/tampered.dump.age.sha256"
# change one byte in the middle of the file
python3 - "$dir/tampered.dump.age" <<'PY' 2>/dev/null || printf '\x00' | dd of="$dir/tampered.dump.age" bs=1 seek=$((bytes / 2)) conv=notrunc 2>/dev/null
import sys
p = sys.argv[1]; b = bytearray(open(p, 'rb').read()); i = len(b) // 2; b[i] ^= 0xFF; open(p, 'wb').write(bytes(b))
PY
must_fail "altered file, caught by the checksum" env "${common[@]}" RESTORE_FILE="$dir/tampered.dump.age" BACKUP_AGE_IDENTITY_FILE="$dir/key.txt" bash "$here/restore.sh"
must_fail "altered file with the checksum skipped, caught by the decryption" env "${common[@]}" RESTORE_SKIP_CHECKSUM=1 RESTORE_FILE="$dir/tampered.dump.age" BACKUP_AGE_IDENTITY_FILE="$dir/key.txt" bash "$here/restore.sh"
must_fail "restore without naming the target database" env PGHOST="$s1" PGUSER="$admin" PGDATABASE=postgres RESTORE_CONFIRM=something-else RESTORE_FILE="$backup" BACKUP_AGE_IDENTITY_FILE="$dir/key.txt" bash "$here/restore.sh"
must_fail "restore over a database that already has tables" env PGHOST="$s1" PGUSER="$admin" PGDATABASE="$src_db" RESTORE_CONFIRM="$src_db" RESTORE_TMPDIR="$dir/tmp" RESTORE_FILE="$backup" BACKUP_AGE_IDENTITY_FILE="$dir/key.txt" bash "$here/restore.sh"
[ -z "$(ls -A "$dir/tmp")" ] || die "a decrypted copy was left behind after a refused restore"

note "8. dropping the original database"
psql_on "$s1" "$admin" -d postgres -c "drop database $src_db"
[ "$(psql_on "$s1" "$admin" -d postgres -Atc "select count(*) from pg_database where datname = '$src_db'")" = "0" ] || die "the database is still there"
echo "   $src_db is gone"

note "9. restore.sh into a fresh database on the same server"
psql_on "$s1" "$admin" -d postgres -c "create database $dst_db"
# the key is passed as text here (BACKUP_AGE_IDENTITY) to exercise that path; step 10 uses the key file
PGHOST="$s1" PGUSER="$admin" PGDATABASE="$dst_db" RESTORE_CONFIRM="$dst_db" RESTORE_TMPDIR="$dir/tmp" RESTORE_FILE="$backup" \
  BACKUP_AGE_IDENTITY="$(grep '^AGE-SECRET-KEY-' "$dir/key.txt")" bash "$here/restore.sh" | sed 's/^/   /'
fingerprint "$s1" "$dst_db" "$dir/after-same-server.txt"
if ! diff "$dir/before.txt" "$dir/after-same-server.txt" > "$dir/diff-same-server.txt"; then
  echo "   DIFFERENCES (first 40 lines):"; head -40 "$dir/diff-same-server.txt" | sed 's/^/   /'; die "the restored database differs from the original"
fi
echo "   identical: $tables tables, $rows rows, $rules rule lines"
[ -z "$(ls -A "$dir/tmp")" ] || die "a decrypted copy was left behind after the restore"

note "9b. the comparison itself is tested: one changed value and one removed rule must each show up"
psql_on "$s1" "$admin" -d "$dst_db" -c "update restore_test.awkward set amount = amount + 0.01 where n = 1000"
fingerprint "$s1" "$dst_db" "$dir/changed-value.txt"
if diff -q "$dir/before.txt" "$dir/changed-value.txt" > /dev/null; then die "a changed value was not noticed by the comparison"; fi
echo "   one cent changed in one row of 2000: noticed"
psql_on "$s1" "$admin" -d "$dst_db" -c "update restore_test.awkward set amount = amount - 0.01 where n = 1000" -c "alter table public.clients no force row level security"
fingerprint "$s1" "$dst_db" "$dir/changed-rule.txt"
[ "$(diff "$dir/before.txt" "$dir/changed-rule.txt" | grep -c '^[<>]')" = "2" ] || die "a weakened access rule was not noticed by the comparison (or the value was not put back)"
echo "   row level security no longer forced on one table: noticed"

note "10. restore onto a brand new server (roles first, then the database)"
start_server two
s2="$dir/two/sock"
psql_on "$s2" "$admin" -d postgres -c "create database $dst_db"
PGHOST="$s2" PGUSER="$admin" PGDATABASE="$dst_db" RESTORE_CONFIRM="$dst_db" RESTORE_TMPDIR="$dir/tmp" RESTORE_FILE="$backup" RESTORE_ROLES_FILE="$roles" \
  BACKUP_AGE_IDENTITY_FILE="$dir/key.txt" bash "$here/restore.sh" | sed 's/^/   /'
fingerprint "$s2" "$dst_db" "$dir/after-new-server.txt"
if ! diff "$dir/before.txt" "$dir/after-new-server.txt" > "$dir/diff-new-server.txt"; then
  echo "   DIFFERENCES (first 40 lines):"; head -40 "$dir/diff-new-server.txt" | sed 's/^/   /'; die "the database restored on the new server differs from the original"
fi
echo "   identical: $tables tables, $rows rows, $rules rule lines"

note "11. the encrypted tax ID: unreadable without the key, readable with it, and the access rules still apply"
user_a="$(psql_on "$s2" "$admin" -d "$dst_db" -Atc "select id from restore_test.ids where key = 'user_a'")"
worker_a="$(psql_on "$s2" "$admin" -d "$dst_db" -Atc "select id from restore_test.ids where key = 'worker_a'")"
tax_sql="select public.get_worker_tax_id('$worker_a')"
login="select set_config('request.jwt.claims', '{\"sub\":\"$user_a\",\"role\":\"authenticated\"}', false)"
if psql_on "$s2" "$admin" -d "$dst_db" -Atc "$login" -c "set role authenticated" -c "$tax_sql" > "$dir/nokey.txt" 2>&1; then
  die "the tax ID was readable without the key"
fi
echo "   without the key: refused"
got="$(psql_on "$s2" "$admin" -d "$dst_db" -At -c "select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false)" -c "$login" -c "set role authenticated" -c "$tax_sql" | tail -n 1)"
# the product stores the digits only, so the comparison ignores the dashes
[ "$(echo "$got" | tr -d '-')" = "123456789" ] || die "the tax ID did not come back after the key was supplied"
echo "   with the key, as the company owner: the stored value comes back"
other="$(psql_on "$s2" "$admin" -d "$dst_db" -At -c "select set_config('request.jwt.claims', '{\"role\":\"anon\"}', false)" -c "set role anon" -c "select count(*) from public.clients" 2>&1 || true)"
case "$other" in *"permission denied"*) echo "   a visitor who is not signed in: still refused on the restored database" ;; *) die "the anonymous role could read clients after the restore" ;; esac
owner_rows="$(psql_on "$s2" "$admin" -d "$dst_db" -At -c "$login" -c "set role authenticated" -c "select count(*) from public.clients" | tail -n 1)"
[ "$owner_rows" = "40" ] || die "owner of company A sees $owner_rows clients after the restore, expected 40 (its own, not company B's 25)"
echo "   owner of company A: sees the 40 clients of A and none of the 25 of B"

note "12. restore onto a server prepared like a new Supabase project (its own roles, auth and storage already there)"
start_server three
s3="$dir/three/sock"
psql_on "$s3" "$admin" -d postgres -c "create database $dst_db"
# what a new project already has: the platform roles and its own "auth", "storage" and "extensions" schemas
psql_on "$s3" "$admin" -d "$dst_db" -f "$root/supabase/tests/setup_local.sql"
part=(PGHOST="$s3" PGUSER="$admin" PGDATABASE="$dst_db" RESTORE_CONFIRM="$dst_db" RESTORE_TMPDIR="$dir/tmp" BACKUP_AGE_IDENTITY_FILE="$dir/key.txt" RESTORE_FILE="$backup_named")
must_fail "the whole backup over the platform's own tables" env "${part[@]}" bash "$here/restore.sh"
[ "$(psql_on "$s3" "$admin" -d "$dst_db" -Atc "select count(*) from pg_tables where schemaname = 'public'")" = "0" ] || die "a failed restore left tables behind"
echo "   and that failed restore left nothing behind (one transaction)"
must_fail "the product without the accounts it refers to" env "${part[@]}" RESTORE_PLATFORM_SCHEMAS="auth storage extensions" bash "$here/restore.sh"
must_fail "a platform table outside the platform schemas" env "${part[@]}" RESTORE_PLATFORM_SCHEMAS="auth storage extensions" RESTORE_PLATFORM_TABLES="public.clients" bash "$here/restore.sh"
env "${part[@]}" RESTORE_PLATFORM_SCHEMAS="auth storage extensions" RESTORE_PLATFORM_TABLES="auth.users storage.buckets storage.objects" bash "$here/restore.sh" | sed 's/^/   /'
must_fail "the same restore a second time" env "${part[@]}" RESTORE_PLATFORM_SCHEMAS="auth storage extensions" RESTORE_PLATFORM_TABLES="auth.users storage.buckets storage.objects" bash "$here/restore.sh"
# One rule is a property of the whole database and no backup of named schemas can carry it: functions created
# later are not open to everyone by default (supabase/migrations/0001_platform.sql sets it). It is put back by hand,
# here and in the written procedure. First the proof that it really is the only thing missing:
fingerprint "$s3" "$dst_db" "$dir/after-platform-raw.txt"
missing="$(diff "$dir/before.txt" "$dir/after-platform-raw.txt" | grep '^[<>]' || true)"
[ "$missing" = "< defaultacl|postgres||f|postgres|EXECUTE" ] || { echo "$missing" | head -40 | sed 's/^/   /'; die "after the restore, more than the one database-wide default differs (or it no longer differs): update this step and docs/security/backup-and-recovery.md"; }
echo "   one database-wide default is not in a backup of named schemas; putting it back as the procedure says"
psql_on "$s3" postgres -d "$dst_db" -c "alter default privileges revoke execute on functions from public"
fingerprint "$s3" "$dst_db" "$dir/after-platform.txt"
if ! diff "$dir/before.txt" "$dir/after-platform.txt" > "$dir/diff-platform.txt"; then
  echo "   DIFFERENCES (first 40 lines):"; head -40 "$dir/diff-platform.txt" | sed 's/^/   /'; die "the database restored onto the prepared server differs from the original"
fi
echo "   identical: $tables tables, $rows rows, $rules rule lines"

summary="$dir/restore-evidence.txt"
{
  echo "Restore drill, local"
  echo "started (UTC):        $started"
  echo "finished (UTC):       $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "PostgreSQL:           $server_version"
  echo "migrations applied:   $migrations"
  echo "tables compared:      $tables"
  echo "rows compared:        $rows"
  echo "rule lines compared:  $rules"
  echo "backup size (bytes):  $bytes"
  echo "backup sha256:        $sum"
  echo "same server restore:  identical"
  echo "new server restore:   identical"
  echo "platform restore:     identical (on a server prepared like a new Supabase project)"
  echo "comparison tested:    one changed value noticed, one weakened rule noticed"
  echo "refusals checked:     wrong key, altered file (checksum), altered file (decryption), unnamed target, non-empty target,"
  echo "                      whole backup over platform tables, product without accounts, restore run twice"
  echo "result:               PASSED"
} > "$summary"
if [ -n "${RESTORE_EVIDENCE_FILE:-}" ]; then cp "$summary" "$RESTORE_EVIDENCE_FILE"; fi
echo
sed 's/^/   /' "$summary"
echo
echo "RESTORE TEST PASSED"

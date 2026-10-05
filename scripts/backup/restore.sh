#!/usr/bin/env bash
# Restores an encrypted backup made by backup.sh into an EMPTY database.
#
#   RESTORE_FILE=/path/lbs_20261003T120000Z.dump.age RESTORE_CONFIRM=<target database name> \
#   BACKUP_AGE_IDENTITY_FILE=/path/to/key.txt \
#   PGHOST=... PGPORT=5432 PGUSER=... PGDATABASE=<target database name> PGPASSWORD=... bash scripts/backup/restore.sh
#
# What it does:
#   1. checks the SHA-256 checksum of the encrypted file against the .sha256 file written with it
#   2. decrypts into a private temporary folder. A damaged or altered file fails here: age authenticates every block.
#   3. refuses to continue if the target database already has tables in the application schemas
#   4. runs pg_restore in one transaction: either everything is restored or nothing is
#   5. deletes the decrypted copy, also when a step fails
#
# Settings (environment variables):
#   RESTORE_FILE              required. The .dump.age file.
#   RESTORE_CONFIRM           required. Must be exactly the name of the target database. A guard against restoring
#                             into the wrong place.
#   BACKUP_AGE_IDENTITY_FILE  the file that holds the age private key, or
#   BACKUP_AGE_IDENTITY       the private key itself (AGE-SECRET-KEY-1...). It is handed to age without being written
#                             to disk and without appearing on a command line.
#   PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD   the TARGET database.
#   RESTORE_ROLES_FILE        optional. A .roles.sql.age file made with BACKUP_INCLUDE_ROLES=1. Applied first. Only for
#                             a brand new PostgreSQL server; do not use it on a Supabase project.
#   RESTORE_SKIP_CHECKSUM=1   optional. Skip step 1 when the .sha256 file is lost. Decryption still authenticates.
#   RESTORE_CHECK_SCHEMAS     optional. Schemas that must be empty in the target. Default: "public app".
#   RESTORE_PLATFORM_SCHEMAS  optional. For a target that is a new project on a hosting platform which creates some
#                             schemas itself (Supabase: "auth storage extensions"). Space-separated. For these
#                             schemas the backup's table definitions are NOT restored (the platform's own are kept);
#                             rows are restored only into the tables named in RESTORE_PLATFORM_TABLES; and the access
#                             policies the product placed on those tables are restored. The target's default
#                             privileges are cleared first, so that they end up the same as the original's.
#   RESTORE_PLATFORM_TABLES   with the setting above: space-separated tables (schema.table) whose rows come back,
#                             for example "auth.users storage.buckets storage.objects". Each must exist in the
#                             target and hold no rows.
#   RESTORE_TMPDIR            optional. Where the decrypted copy is held for the length of the restore.
#   PGBIN                     optional. Folder that holds pg_restore and psql.
#
# Exit code: 0 restored. Anything else: the target database was left as it was (the restore is one transaction).
set -euo pipefail
umask 077

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/backup/lib.sh
. "$here/lib.sh"

file="${RESTORE_FILE:-}"
[ -n "$file" ] || die "RESTORE_FILE is not set"
[ -f "$file" ] || die "file not found: $file"
need_connection
[ "${RESTORE_CONFIRM:-}" = "$PGDATABASE" ] || die "RESTORE_CONFIRM must be exactly the name of the target database ($PGDATABASE)"
if [ -z "${BACKUP_AGE_IDENTITY:-}" ] && [ -z "${BACKUP_AGE_IDENTITY_FILE:-}" ]; then
  die "set BACKUP_AGE_IDENTITY_FILE (a file holding the age private key) or BACKUP_AGE_IDENTITY (the key itself)"
fi
if [ -n "${BACKUP_AGE_IDENTITY_FILE:-}" ] && [ ! -f "$BACKUP_AGE_IDENTITY_FILE" ]; then die "key file not found: $BACKUP_AGE_IDENTITY_FILE"; fi

pg_restore="$(pg_tool pg_restore)" || die "pg_restore not found. Install the PostgreSQL client tools or set PGBIN."
psql="$(pg_tool psql)" || die "psql not found. Install the PostgreSQL client tools or set PGBIN."
need_tool age "Install it from https://age-encryption.org (Windows: winget install FiloSottile.age)."

# Decrypts $1 into $2. The private key reaches age through a file descriptor, never through an argument.
decrypt() {
  if [ -n "${BACKUP_AGE_IDENTITY_FILE:-}" ]; then
    age -d -i "$BACKUP_AGE_IDENTITY_FILE" -o "$2" "$1"
  else
    age -d -i /dev/fd/3 -o "$2" "$1" 3<<<"$BACKUP_AGE_IDENTITY"
  fi
}
check_sum() { # check_sum <file>
  local f="$1" want got
  if [ "${RESTORE_SKIP_CHECKSUM:-0}" = "1" ]; then note "checksum skipped on request for $(basename "$f")"; return 0; fi
  [ -f "$f.sha256" ] || die "checksum file not found: $f.sha256 (set RESTORE_SKIP_CHECKSUM=1 only if it is truly lost)"
  want="$(cut -d' ' -f1 < "$f.sha256")"
  got="$(sha256_of "$f")"
  [ "$want" = "$got" ] || die "checksum mismatch for $(basename "$f"): the file is damaged or was changed after the backup"
  note "checksum ok: $(basename "$f")"
}

check_sum "$file"

work="$(mktemp -d "${RESTORE_TMPDIR:-${TMPDIR:-/tmp}}/vx-restore.XXXXXX")"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT

plain="$work/restore.dump"
decrypt "$file" "$plain" || die "decryption failed: wrong key, or the file is damaged"
[ -s "$plain" ] || die "the decrypted file is empty"
"$pg_restore" --list "$plain" > "$work/contents.txt" || die "the decrypted file is not a pg_dump archive"
note "decrypted: $(grep -c ' TABLE DATA ' "$work/contents.txt" || true) tables of data in the archive"

server_version="$("$psql" -X -At --no-password -c 'show server_version')" || die "cannot connect to the target database"
restore_version="$("$pg_restore" --version)"
restore_args=(--no-password --exit-on-error --single-transaction)
schemas_in="'$(echo "${RESTORE_CHECK_SCHEMAS:-public app}" | sed "s/ /','/g")'"
existing="$("$psql" -X -At --no-password -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p') and n.nspname in ($schemas_in)")"
[ "$existing" = "0" ] || die "the target database already has $existing table(s) in ${RESTORE_CHECK_SCHEMAS:-public app}. Restore into an empty database, never over live data."

platform="${RESTORE_PLATFORM_SCHEMAS:-}"
platform_tables="${RESTORE_PLATFORM_TABLES:-}"
if [ -n "$platform" ]; then
  for t in $platform_tables; do
    echo "$t" | grep -Eq '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$' || die "RESTORE_PLATFORM_TABLES: \"$t\" is not written as schema.table"
    case " $platform " in *" ${t%%.*} "*) ;; *) die "RESTORE_PLATFORM_TABLES: $t is not in one of the schemas of RESTORE_PLATFORM_SCHEMAS" ;; esac
    n="$("$psql" -X -At --no-password -c "select count(*) from $t" 2>/dev/null)" || die "table $t does not exist in the target database"
    [ "$n" = "0" ] || die "table $t already holds $n row(s) in the target. Rows are only loaded into empty tables."
  done
elif [ -n "$platform_tables" ]; then
  die "RESTORE_PLATFORM_TABLES is set without RESTORE_PLATFORM_SCHEMAS"
fi

if [ -n "${RESTORE_ROLES_FILE:-}" ]; then
  [ -f "$RESTORE_ROLES_FILE" ] || die "roles file not found: $RESTORE_ROLES_FILE"
  check_sum "$RESTORE_ROLES_FILE"
  decrypt "$RESTORE_ROLES_FILE" "$work/roles.sql" || die "decryption of the roles file failed"
  # A role that is already there (the server's own administrator, for one) is fine. Any other error is not.
  "$psql" -X -q --no-password -d "$PGDATABASE" -f "$work/roles.sql" > /dev/null 2> "$work/roles.err" || true
  if grep -E 'ERROR' "$work/roles.err" | grep -vq 'already exists'; then
    grep -E 'ERROR' "$work/roles.err" | grep -v 'already exists' | sed 's/^/   /' >&2
    die "the roles could not be created"
  fi
  note "roles applied"
fi

# What is restored is chosen from the archive's table of contents:
#   * A schema the target already has is kept as it is: its "create" entry is left out (a backup of chosen schemas
#     carries "CREATE SCHEMA public", and every database already has that schema). Everything inside it is restored.
#   * An extension the target already has is left alone.
#   * In a platform schema, only three kinds of entry are taken: rows of the named tables, the sequences' positions
#     of those tables, and policies. The platform's own tables, functions and privileges are not touched.
"$psql" -X -At --no-password -c "select nspname from pg_namespace" > "$work/schemas.txt"
"$psql" -X -At --no-password -c "select extname from pg_extension" > "$work/extensions.txt"
awk -v list="$work/schemas.txt" -v exts="$work/extensions.txt" -v platform="$platform" -v tables="$platform_tables" '
  BEGIN {
    while ((getline s < list) > 0) have[s] = 1
    while ((getline e < exts) > 0) ext[e] = 1
    n = split(platform, ps, " "); for (i = 1; i <= n; i++) plat[ps[i]] = 1
    n = split(tables, ts, " "); for (i = 1; i <= n; i++) { split(ts[i], st, "."); want[st[1] " " st[2]] = 1 }
  }
  !/^[0-9]+; [0-9]+ [0-9]+ / { print; next }
  {
    # the words after the three numbers: a type of one or more capital words, then schema, name, owner
    rest = $0; sub(/^[0-9]+; [0-9]+ [0-9]+ /, "", rest)
    type = rest; sub(/ [^A-Z].*$/, "", type); if (type !~ /^[A-Z]+( [A-Z]+)*$/) { match(rest, /^[A-Z]+( [A-Z]+)* /); type = substr(rest, 1, RLENGTH - 1) }
    after = substr(rest, length(type) + 2); split(after, f, " ")
  }
  type == "SCHEMA" && f[1] == "-" { if (f[2] in have) { note["schemas already in the target, kept as they are: "] = note["schemas already in the target, kept as they are: "] f[2] " "; next } }
  type == "COMMENT" && f[1] == "-" && f[2] == "SCHEMA" { if (f[3] in have) next }
  type == "EXTENSION" && f[1] == "-" { if (f[2] in ext) next }
  type == "COMMENT" && f[1] == "-" && f[2] == "EXTENSION" { if (f[3] in ext) next }
  (f[1] in plat) {
    if (type == "POLICY") { policies++; print; next }
    if ((type == "TABLE DATA" || type == "SEQUENCE SET") && ((f[1] " " f[2]) in want)) { if (type == "TABLE DATA") loaded[f[1] "." f[2]] = 1; print; next }
    if (type == "TABLE DATA") skipped[f[1] "." f[2]] = 1
    next
  }
  { print }
  END {
    for (k in note) print k note[k] > "/dev/stderr"
    if (platform != "") {
      l = ""; for (k in loaded) l = l k " "; print "platform tables whose rows are restored: " (l == "" ? "none" : l) > "/dev/stderr"
      k2 = ""; for (k in skipped) k2 = k2 k " "; if (k2 != "") print "platform tables whose rows are NOT restored (not named): " k2 > "/dev/stderr"
      print "policies restored on platform tables: " policies + 0 > "/dev/stderr"
    }
  }
' "$work/contents.txt" > "$work/use.txt" 2> "$work/kept.txt"
while IFS= read -r line; do note "$line"; done < "$work/kept.txt"
restore_args+=(--use-list="$work/use.txt")

if [ -n "$platform" ]; then
  # A new project comes with default privileges of its own (on Supabase: everything created in "public" is granted to
  # the browser roles). Objects created by the restore would pick those up. They are removed here, and the archive
  # then sets the default privileges the original had.
  "$psql" -X -q --no-password -v ON_ERROR_STOP=1 > /dev/null <<'SQL' || die "the default privileges of the target could not be cleared"
select format('alter default privileges for role %I %s revoke all on %s from %s',
         pg_get_userbyid(d.defaclrole),
         case when d.defaclnamespace = 0 then '' else format('in schema %I', n.nspname) end,
         case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' when 'T' then 'types' when 'n' then 'schemas' end,
         case when a.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end)
from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
where pg_has_role(current_user, d.defaclrole, 'USAGE') and a.grantee <> d.defaclrole
group by 1
\gexec
SQL
  note "default privileges of the target cleared (the archive sets the original ones)"
fi

note "restoring into \"$PGDATABASE\" (server $server_version, $restore_version)"
"$pg_restore" "${restore_args[@]}" --dbname="$PGDATABASE" "$plain" \
  || die "pg_restore failed. Nothing was changed: the restore runs in one transaction."
note "restore finished"

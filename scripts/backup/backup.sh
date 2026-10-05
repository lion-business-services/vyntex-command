#!/usr/bin/env bash
# Encrypted backup of one database, kept outside the hosting platform.
#
#   BACKUP_LABEL=lbs BACKUP_DIR=/path/outside/the/repository BACKUP_AGE_RECIPIENT=age1... \
#   PGHOST=... PGPORT=5432 PGUSER=... PGDATABASE=postgres PGPASSWORD=... bash scripts/backup/backup.sh
#
# What it does:
#   1. runs pg_dump in custom format (the format pg_restore reads)
#   2. encrypts the dump while it is being written, so no readable copy ever touches the disk
#   3. writes a SHA-256 checksum file and a small manifest next to the encrypted file
#
# Encryption: age (https://age-encryption.org), to a public key. The computer that makes backups holds only the
# public key (BACKUP_AGE_RECIPIENT), which can encrypt and cannot decrypt. The private key stays in the company
# password manager and is needed only to restore. "openssl enc" is not used: it refuses authenticated modes such as
# AES-256-GCM ("AEAD ciphers not supported"), and an unauthenticated mode cannot tell a damaged file from a good one.
#
# Settings (environment variables):
#   BACKUP_LABEL           required. Which deployment this is: vyntex or lbs. Becomes part of the file name, so the two
#                          deployments' backups can never be confused. Lowercase letters, digits and hyphens.
#   BACKUP_DIR             required. Folder for the result. Must not be inside this repository.
#   BACKUP_AGE_RECIPIENT   required. The age public key (starts with age1).
#   PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD   the database, the standard PostgreSQL way. PGPASSFILE works too.
#   BACKUP_SCHEMAS         optional. Space-separated schemas to include. Empty means the whole database.
#   BACKUP_EXCLUDE_SCHEMAS optional. Space-separated schemas to leave out.
#   BACKUP_INCLUDE_ROLES=1 optional. Also saves the list of database roles (no passwords), encrypted. Needed to restore
#                          onto a brand new PostgreSQL server; a Supabase project already has its standard roles.
#   PGBIN                  optional. Folder that holds pg_dump and psql.
#
# Exit code: 0 the backup, its checksum and its manifest are written. Anything else: nothing usable was written.
#
# What a backup does NOT contain: the encryption key for tax IDs (it lives in Supabase Vault and in the password
# manager, on purpose), the files in Supabase Storage (see docs/security/backup-and-recovery.md), and database-level
# settings. A backup is not proven until a restore of it has been tried: scripts/backup/restore-test.sh.
set -euo pipefail
umask 077

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/backup/lib.sh
. "$here/lib.sh"

label="${BACKUP_LABEL:-}"
[ -n "$label" ] || die "BACKUP_LABEL is not set (vyntex or lbs)"
echo "$label" | grep -Eq '^[a-z0-9][a-z0-9-]{0,30}$' || die "BACKUP_LABEL may hold lowercase letters, digits and hyphens only"
[ -n "${BACKUP_DIR:-}" ] || die "BACKUP_DIR is not set"
recipient="${BACKUP_AGE_RECIPIENT:-}"
[ -n "$recipient" ] || die "BACKUP_AGE_RECIPIENT is not set (the age public key, starts with age1)"
case "$recipient" in age1*) ;; AGE-SECRET-KEY-*) die "BACKUP_AGE_RECIPIENT holds a private key. Put the PUBLIC key here (starts with age1)." ;; *) die "BACKUP_AGE_RECIPIENT does not look like an age public key" ;; esac
need_connection

pg_dump="$(pg_tool pg_dump)" || die "pg_dump not found. Install the PostgreSQL client tools or set PGBIN."
psql="$(pg_tool psql)" || die "psql not found. Install the PostgreSQL client tools or set PGBIN."
need_tool age "Install it from https://age-encryption.org (Windows: winget install FiloSottile.age)."

mkdir -p "$BACKUP_DIR"
out_dir="$(cd "$BACKUP_DIR" && pwd)"
# An encrypted backup is still a copy of client data. It does not belong in a Git repository.
if command -v git >/dev/null 2>&1 && git -C "$out_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$out_dir" check-ignore -q "$out_dir" 2>/dev/null || die "BACKUP_DIR is inside a Git repository. Choose a folder outside it."
fi

server_version="$("$psql" -X -At --no-password -c 'show server_version')" || die "cannot connect to the database (check PGHOST, PGPORT, PGUSER, PGDATABASE and the password)"
dump_version="$("$pg_dump" --version)"
if [ "$(major_of "$dump_version")" -lt "$(major_of "$server_version")" ]; then
  die "pg_dump is version $(major_of "$dump_version") and the server is version $(major_of "$server_version"). Install client tools at least as new as the server."
fi

args=(--format=custom --no-password)
schemas="${BACKUP_SCHEMAS:-}"
for s in $schemas; do args+=("--schema=$s"); done
for s in ${BACKUP_EXCLUDE_SCHEMAS:-}; do args+=("--exclude-schema=$s"); done

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="${label}_${stamp}.dump.age"
file="$out_dir/$name"
partial="$file.partial"
roles_file="$out_dir/${label}_${stamp}.roles.sql.age"
cleanup() { rm -f "$partial" "$roles_file.partial"; }
trap cleanup EXIT

note "backing up database \"$PGDATABASE\" as \"$label\" (server $server_version, $dump_version)"
# pg_dump writes to the pipe and age encrypts what comes out of it. pipefail makes a failure of either one fail the run.
"$pg_dump" "${args[@]}" | age -r "$recipient" -o "$partial"
[ -s "$partial" ] || die "the encrypted file is empty"
mv "$partial" "$file"

roles_name=""
if [ "${BACKUP_INCLUDE_ROLES:-0}" = "1" ]; then
  pg_dumpall="$(pg_tool pg_dumpall)" || die "pg_dumpall not found"
  "$pg_dumpall" --roles-only --no-role-passwords --no-password | age -r "$recipient" -o "$roles_file.partial"
  mv "$roles_file.partial" "$roles_file"
  roles_name="$(basename "$roles_file")"
  ( cd "$out_dir" && echo "$(sha256_of "$roles_name")  $roles_name" > "$roles_name.sha256" )
fi

sum="$(sha256_of "$file")"
( cd "$out_dir" && echo "$sum  $name" > "$name.sha256" )
bytes="$(size_of "$file")"
# The manifest says what the file is. It holds no address, no user name, no password and no key that can decrypt.
cat > "$out_dir/${label}_${stamp}.manifest.json" <<JSON
{
  "label": "$label",
  "created_utc": "$stamp",
  "file": "$name",
  "bytes": $bytes,
  "sha256": "$sum",
  "format": "pg_dump custom format, encrypted with age",
  "pg_dump": "$dump_version",
  "server_version": "$server_version",
  "schemas": "${schemas:-all}",
  "roles_file": "${roles_name}",
  "encrypted_to": "$recipient"
}
JSON

note "written: $file ($bytes bytes)"
note "sha256:  $sum"
note "This backup is not proven until a restore of it has been tried. See docs/security/backup-and-recovery.md."

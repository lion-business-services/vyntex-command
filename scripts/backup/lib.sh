# Shared by backup.sh, restore.sh and restore-test.sh. Sourced, not run.
# Nothing here prints a password, a key or a connection string.

die() { echo "error: $*" >&2; exit 1; }
note() { echo "== $*"; }

# Finds a PostgreSQL program: in $PGBIN when set, else the Debian/Ubuntu folder, else on PATH.
pg_tool() {
  local name="$1" dir
  for dir in "${PGBIN:-}" /usr/lib/postgresql/17/bin /usr/lib/postgresql/16/bin /usr/lib/postgresql/15/bin; do
    if [ -n "$dir" ] && [ -x "$dir/$name" ]; then echo "$dir/$name"; return 0; fi
  done
  command -v "$name" 2>/dev/null || return 1
}

need_tool() { # need_tool <name> <how to get it>
  command -v "$1" >/dev/null 2>&1 || die "$1 is not installed. $2"
}

# SHA-256 of a file, hex only. Linux and Git Bash have sha256sum; macOS has shasum.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else die "no sha256sum or shasum program found"; fi
}

# Size of a file in bytes.
size_of() { wc -c < "$1" | tr -d ' '; }

# Major version number out of "pg_dump (PostgreSQL) 16.4" or "16.4 (Ubuntu ...)".
major_of() { echo "$1" | sed -E 's/^[^0-9]*([0-9]+).*/\1/'; }

# The connection comes from the standard PostgreSQL variables, never from an address typed on the command line,
# because a command line is visible to every other program on the computer while it runs.
need_connection() {
  [ -n "${PGHOST:-}" ] || die "PGHOST is not set (the database host, or a socket folder for a local server)"
  [ -n "${PGUSER:-}" ] || die "PGUSER is not set"
  [ -n "${PGDATABASE:-}" ] || die "PGDATABASE is not set"
}

#!/usr/bin/env bash
#
# Pushes the application's environment variables to the Vercel project and
# triggers a deployment.
#
#   1. vercel login          (once, interactive — only you can do this)
#   2. bash scripts/setup-vercel-env.sh
#
# Values are read from .env.vercel.local, which is gitignored and never
# leaves this machine except to Vercel itself. Re-running is safe: each
# variable is removed and re-added, so the script is idempotent.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.vercel.local"
PROJECT="${VERCEL_PROJECT:-elizabeth-moir-ams-api}"
VARS=(INGEST_PATH_TOKEN REPORT_TOKEN TRUST_PROXY)
ENVIRONMENTS=(production preview development)

die() { printf '\nerror: %s\n' "$1" >&2; exit 1; }
vercel() { npx --yes vercel@latest "$@"; }

[ -f "$ENV_FILE" ] || die "$ENV_FILE not found. It holds the tokens; regenerate it if it was deleted."

echo "==> Checking Vercel authentication"
if ! WHO=$(vercel whoami 2>&1); then
  die "not logged in. Run:  npx vercel login    then re-run this script."
fi
echo "    logged in as: $WHO"

echo "==> Linking the local directory to project '$PROJECT'"
vercel link --yes --project "$PROJECT" >/dev/null 2>&1 \
  || die "could not link to '$PROJECT'. Check the name, or set VERCEL_PROJECT=<name> and retry."
echo "    linked"

# Read one KEY=VALUE from the env file, ignoring comments and blank lines.
value_of() {
  sed -n "s/^$1=//p" "$ENV_FILE" | head -1
}

for name in "${VARS[@]}"; do
  value="$(value_of "$name")"
  [ -n "$value" ] || die "$name has no value in $ENV_FILE"

  for env in "${ENVIRONMENTS[@]}"; do
    # Remove first so a re-run updates rather than failing on a duplicate.
    vercel env rm "$name" "$env" --yes >/dev/null 2>&1
    if printf '%s' "$value" | vercel env add "$name" "$env" >/dev/null 2>&1; then
      echo "    set $name ($env)"
    else
      echo "    FAILED to set $name ($env)" >&2
    fi
  done
done

echo
echo "==> Variables in the project now:"
vercel env ls 2>/dev/null | sed 's/^/    /'

echo
echo "==> Deploying (environment variables are read at build time)"
vercel --prod --yes || die "deployment failed; check the output above"

echo
echo "Done. Next:"
echo "  bash scripts/smoke-test.sh          verify the live deployment"

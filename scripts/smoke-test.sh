#!/usr/bin/env bash
#
# Verifies a deployed harness end to end. Reads the tokens from
# .env.vercel.local so no secret is ever typed on a command line (where it
# would land in shell history).
#
#   bash scripts/smoke-test.sh [base-url]
#
# Default base URL: https://elizabeth-moir-ams-api.vercel.app

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.vercel.local"
BASE="${1:-https://elizabeth-moir-ams-api.vercel.app}"

[ -f "$ENV_FILE" ] || { echo "error: $ENV_FILE not found" >&2; exit 1; }
value_of() { sed -n "s/^$1=//p" "$ENV_FILE" | head -1; }
INGEST="$(value_of INGEST_PATH_TOKEN)"
REPORT="$(value_of REPORT_TOKEN)"
[ -n "$INGEST" ] && [ -n "$REPORT" ] || { echo "error: tokens missing from $ENV_FILE" >&2; exit 1; }

pass=0; fail=0
check() { # check <description> <expected-status> <actual-status>
  if [ "$2" = "$3" ]; then printf '  PASS  %-52s %s\n' "$1" "$3"; pass=$((pass+1));
  else printf '  FAIL  %-52s got %s, expected %s\n' "$1" "$3" "$2"; fail=$((fail+1)); fi
}
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "Smoke-testing $BASE"
echo
echo "Reachability"
check "GET /healthz" 200 "$(status "$BASE/healthz")"

echo
echo "The endpoint must not be discoverable without the token"
check "POST /ingest/raw (unprotected path)" 404 "$(status -X POST -H 'content-type: application/json' -d '[]' "$BASE/ingest/raw")"
check "GET /ingest/report (no token)" 404 "$(status "$BASE/ingest/report")"
check "GET /ingest/report (wrong token)" 404 "$(status "$BASE/ingest/report?token=wrong-token-that-is-long-enough-x")"

echo
echo "Ingest accepts anything and always answers 200"
SAMPLE='[{"EmpId":"20","AttTime":"2024-01-08 16:58:03","CheckingStatus":"0","VerifyType":"1","DeviceID":"SMOKE-TEST-DEVICE"}]'
URL="$BASE/ingest/$INGEST/raw"
check "POST valid batch, application/json" 200 "$(status -X POST -H 'content-type: application/json' -d "$SAMPLE" "$URL")"
check "POST with no content-type" 200 "$(status -X POST -d "$SAMPLE" "$URL")"
check "POST malformed JSON" 200 "$(status -X POST -H 'content-type: application/json' -d '[{broken' "$URL")"
check "POST empty body" 200 "$(status -X POST -H 'content-type: application/json' "$URL")"
check "POST text/plain" 200 "$(status -X POST -H 'content-type: text/plain' -d "$SAMPLE" "$URL")"
check "GET on the ingest path" 200 "$(status "$URL")"

echo
echo "Ingest latency (what the platform experiences)"
for i in 1 2 3; do
  t=$(curl -s -o /dev/null -w '%{time_total}' -X POST -H 'content-type: application/json' -d "$SAMPLE" "$URL")
  printf '  request %d: %ss\n' "$i" "$t"
done

echo
echo "Report renders and reflects what was posted"
BODY="$(curl -s "$BASE/ingest/report?token=$REPORT")"
if printf '%s' "$BODY" | grep -q 'SMOKE-TEST-DEVICE'; then
  printf '  PASS  %-52s\n' "report contains the posted device"; pass=$((pass+1))
else
  printf '  FAIL  %-52s\n' "report does not contain the posted device"; fail=$((fail+1))
fi
if printf '%s' "$BODY" | grep -q 'Ingest discovery report'; then
  printf '  PASS  %-52s\n' "report page rendered"; pass=$((pass+1))
else
  printf '  FAIL  %-52s\n' "report page did not render"; fail=$((fail+1))
fi

echo
echo "Findings so far, from the JSON report"
curl -s "$BASE/ingest/report.json?token=$REPORT" \
  | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{const r=JSON.parse(s);
    console.log('  deliveries:      ', r.totals.deliveries);
    console.log('  events:          ', r.totals.events);
    console.log('  parse errors:    ', r.totals.deliveriesWithParseError);
    console.log('  distinct EmpIds: ', r.totals.distinctEmpIds);
    console.log('  distinct devices:', r.totals.distinctDevices);
    console.log('  source IPs:      ', r.sourceIps.map(i=>i.value+' x'+i.count).join(', ') || 'none');
  }catch(e){console.log('  (could not parse report JSON)');}
});" 2>/dev/null || echo "  (node not available)"

echo
echo "-----------------------------------------------"
printf '  %d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -eq 0 ]; then
  echo
  echo "The harness is live. Point ADMS at:"
  echo "  $BASE/ingest/$INGEST/raw"
  echo "(ADMS -> System -> Webhook -> Webhook URL -> Save Configuration)"
  echo
  echo "Read the findings at:"
  echo "  $BASE/ingest/report?token=$REPORT"
  exit 0
fi
exit 1

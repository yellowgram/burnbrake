#!/usr/bin/env bash
# Run inside a project where the packed burnbrake tarball is installed (scripts/pack-smoke.sh does this).
# Proves the installed bin (an npm symlink) really runs: --help prints usage and serve stays up.
set -uo pipefail
out=$(npx --no-install burnbrake --help)
grep -q "BurnBrake — request-path spend governor" <<<"$out" || { echo "installed burnbrake --help did not print usage"; exit 1; }
echo "installed bin --help ok"
tmp=$(mktemp -d)
BURNBRAKE_KEY=bb_ci_local_only_not_a_real_key BURNBRAKE_MOCK_UPSTREAM=1 BURNBRAKE_PORT=0 \
  BURNBRAKE_LEDGER_PATH="$tmp/ledger.sqlite" timeout 5 npx --no-install burnbrake serve >"$tmp/serve.log" 2>&1
rc=$?
if [ "$rc" -ne 124 ] || ! grep -q "listening on http" "$tmp/serve.log"; then
  echo "installed burnbrake serve did not stay up (exit $rc)"; cat "$tmp/serve.log"; exit 1
fi
echo "installed bin serve ok: listening, still running after 5 s"

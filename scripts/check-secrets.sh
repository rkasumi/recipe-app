#!/usr/bin/env bash
set -euo pipefail

patterns='(CLOUDFLARE_API_TOKEN|CF_API_TOKEN|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|password=|passwd=|secret=|token=|webhook_url=)'

set +e
rg -n --hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!coverage/**' --glob '!.git/**' --glob '!pnpm-lock.yaml' --glob '!scripts/check-secrets.sh' "$patterns" .
status=$?
set -e

if [[ $status -eq 0 ]]; then
  echo "Potential secret-like text found. Review the matches above." >&2
  exit 1
fi

if [[ $status -ne 1 ]]; then
  echo "Secret scan failed with rg exit code $status." >&2
  exit "$status"
fi

echo "No obvious secret patterns found."

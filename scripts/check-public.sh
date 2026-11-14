#!/usr/bin/env bash
# Fails if the tree contains things that must not ship in a public repo: the maintainer's private
# network addresses, home-directory paths, App Store Connect key identifiers, or private keys.
# Run in CI (public-check job) and before flipping the repo public.
set -u
cd "$(git rev-parse --show-toplevel)"
patterns=(
  '100\.106\.118\.45'          # maintainer's Tailscale IP
  '192\.168\.100\.10\b'        # maintainer's LAN IP
  'C:\\Users\\gary'            # Windows home path
  '/Users/gary\.hsieh'         # macOS home path
  'S4KA24P9A5'                 # ASC API key id
  'efcfbd71-5d12-4d85-8efc'    # ASC issuer id
  'BEGIN (EC |RSA )?PRIVATE KEY'
)
fail=0
for p in "${patterns[@]}"; do
  hits=$(git grep -nIE "$p" -- . ':!scripts/check-public.sh' 2>/dev/null)
  if [ -n "$hits" ]; then echo "✗ /$p/"; echo "$hits" | head -20; fail=1; fi
done
if git ls-files | grep -E '\.(p8|p12|mobileprovision|jks)$|(^|/)\.env$' | grep -v debug.keystore; then
  echo "✗ secret-looking files are tracked"; fail=1
fi
[ $fail -eq 0 ] && echo "✓ public-check passed"
exit $fail

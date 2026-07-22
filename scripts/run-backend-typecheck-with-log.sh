#!/usr/bin/env bash
set -euo pipefail

npm run typecheck 2>&1 | tee typecheck.log

#!/bin/bash
# Prepara o ambiente do Claude Code na web: dependências do Veloxia e o
# Postgres local usado pelos testes do servidor (veloxia/server/vitest.config.ts).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}/veloxia"

# O Chromium já vem instalado no container; não baixar outro.
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
npm install --no-audit --no-fund

# Postgres para os testes (mesmas credenciais do CI).
if command -v pg_isready >/dev/null 2>&1; then
  if ! pg_isready -q -h localhost; then
    service postgresql start >/dev/null
    for _ in $(seq 1 30); do pg_isready -q -h localhost && break; sleep 1; done
  fi
  su postgres -c "psql -qtAc \"SELECT 1 FROM pg_roles WHERE rolname='veloxia'\"" | grep -q 1 \
    || su postgres -c "psql -qc \"CREATE ROLE veloxia LOGIN SUPERUSER PASSWORD 'veloxia'\""
  su postgres -c "psql -qtAc \"SELECT 1 FROM pg_database WHERE datname='veloxia_test'\"" | grep -q 1 \
    || su postgres -c "createdb -O veloxia veloxia_test"
  echo 'export TEST_DATABASE_URL="postgres://veloxia:veloxia@localhost:5432/veloxia_test"' >> "${CLAUDE_ENV_FILE:-/dev/null}"
fi

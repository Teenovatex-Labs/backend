#!/usr/bin/env bash
set -euo pipefail

echo "==> Deploying TeenovateX Backend on $(hostname)..."
cd /home/ubuntu/teenovatex

echo "==> Rebuilding Docker container..."
sudo docker compose build --pull api

echo "==> Running Prisma migration inside container..."
sudo docker compose run --rm --no-deps api npx prisma migrate deploy

echo "==> Starting API container..."
sudo docker compose up -d --no-deps api

echo "==> Waiting for container readiness..."
for i in {1..15}; do
  if curl -fsS http://127.0.0.1:4100/health/ready >/dev/null 2>&1; then
    echo "==> Backend is healthy and ready!"
    exit 0
  fi
  echo "Waiting for health check ($i/15)..."
  sleep 2
done

echo "Error: Backend health check failed after deploy." >&2
sudo docker compose logs --tail 50 api || true
exit 1

#!/usr/bin/env bash
set -euo pipefail

echo "==> Deploying TeenovateX Backend on $(hostname)..."
cd /home/ubuntu/teenovatex/backend

echo "==> Pulling latest main..."
git pull origin main

echo "==> Rebuilding Docker container..."
cd /home/ubuntu/teenovatex
docker compose build --pull api

echo "==> Running Prisma migration inside container..."
docker compose run --rm --no-deps api npx prisma migrate deploy

echo "==> Starting API container..."
docker compose up -d --no-deps api

echo "==> Waiting for container readiness..."
sleep 4
for i in {1..15}; do
  if curl -fsS http://127.0.0.1:4100/health/ready >/dev/null 2>&1; then
    echo "==> Backend is healthy and ready!"
    docker system prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  echo "Waiting for health check ($i/15)..."
  sleep 2
done

echo "Error: Backend health check failed after deploy." >&2
docker logs --tail 50 teenovatex-api
exit 1

#!/bin/sh
set -eu

case "${APP_NAME:-}" in
  control-api | workflow-worker | runtime-worker | runtime-gateway | tool-gateway) ;;
  *)
    echo "APP_NAME must identify a deployable Control Plane service" >&2
    exit 64
    ;;
esac

exec bun --cwd="/workspace/apps/${APP_NAME}" run start

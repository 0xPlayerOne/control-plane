#!/bin/sh
set -eu

case "${APP_NAME:-}" in
  control-api | hosted-control-plane | local-control-plane | workflow-worker | runtime-worker | runtime-gateway | tool-gateway) ;;
  *)
    echo "APP_NAME must identify a deployable Control Plane service" >&2
    exit 64
    ;;
esac

exec bun "/workspace/apps/${APP_NAME}/dist/start.js"

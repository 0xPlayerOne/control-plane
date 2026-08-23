# Service configuration and bootstrap

All deployable services enter through `@control-plane/bootstrap`, which loads their typed
configuration from `@control-plane/config`, installs shutdown and fatal-error handlers, and exposes
common health and readiness state.

## Environments

`APP_ENV` accepts exactly `development`, `test`, `staging`, or `production`. It is resolved once from
the server process environment during startup; request data is never an environment selector.

Development and test load local files in this order, with later files taking precedence:

1. `.env`
2. `.env.local`
3. `.env.<environment>`
4. `.env.<environment>.local`
5. Variables already present in the process environment

Staging and production never load dotenv files. Their configuration must be injected by the runtime,
container orchestrator, or secrets manager. `SERVICE_VERSION` and `COMMIT_SHA` are mandatory in both
modes. Invalid startup configuration reports only missing or invalid variable names, never values.

Copy the relevant `apps/<service>/.env.example` to `.env.local` inside that service for local
development. Example files contain only non-secret values and are safe to commit. Never commit a
populated `.env`, `.env.local`, key, token, credential, or production connection string.

## Service surfaces

| Service           | Variable                      | Default | Constraint                   |
| ----------------- | ----------------------------- | ------- | ---------------------------- |
| `control-api`     | `CONTROL_API_PORT`            | `3000`  | Integer from 1 through 65535 |
| `runtime-gateway` | `RUNTIME_GATEWAY_PORT`        | `3001`  | Integer from 1 through 65535 |
| `tool-gateway`    | `TOOL_GATEWAY_PORT`           | `3002`  | Integer from 1 through 65535 |
| `workflow-worker` | `WORKFLOW_WORKER_CONCURRENCY` | `1`     | Integer from 1 through 256   |
| `runtime-worker`  | `RUNTIME_WORKER_CONCURRENCY`  | `1`     | Integer from 1 through 256   |

Every service publishes application metadata containing its service name, version, commit SHA,
environment, and instance ID. HTTP services expose the metadata through the `/health` and `/ready`
conventions. Workers expose equivalent `health()` and `readiness()` hooks on their service runtime.
Neither surface includes raw environment variables or secrets.

## Shutdown and diagnostics

`SIGINT` and `SIGTERM` mark the service unready and close registered resources in reverse order.
Unhandled rejections, uncaught exceptions, and startup failures use the same shutdown path and set a
failed process exit code. Resource shutdown is idempotent.

Structured diagnostics pass through redaction before serialization. Keys containing token, secret,
password, credential, authorization, cookie, private key, or API key are replaced with
`[REDACTED]`; callers can provide additional sensitive keys for service-specific configuration.

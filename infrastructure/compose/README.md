# Hosted Control Plane

This Compose project packages the provider-neutral Control Plane for a user-controlled Linux host. It does not require Railway, Neon, Cloudflare R2, or Agent HQ credentials.

## Simple profile

The `simple` profile is the default small-VPS topology. One container runs the Control API, SQLite persistence, filesystem artifact storage, the canonical workflow endpoint, and a single-node Restate runtime. Its only durable state is the operator-owned directory mounted at `/var/lib/control-plane`.

```sh
cd infrastructure/compose
cp .env.example .env
mkdir -p data/simple
chmod 700 data/simple
docker compose --profile simple up --build -d
docker compose --profile simple ps
```

The API binds to `127.0.0.1:3000` by default. Readiness is available at `/ready`. The bearer credential is generated inside `data/simple`; do not publish the port directly or copy that credential into Compose configuration. Use a same-host TLS reverse proxy with authentication, or the outbound encrypted relay adapter when it is configured.

## Server profile

The `server` profile runs three long-lived services: the all-in-one hosted Control Plane, PostgreSQL, and Restate. A one-shot migration container applies the versioned schema before the Control Plane starts. PostgreSQL and Restate stay private on the Compose network; only the Control API is published to host loopback.

Set a URL-safe PostgreSQL password before the first start. An empty value fails closed because PostgreSQL refuses initialization.

```sh
cd infrastructure/compose
cp .env.example .env
password=$(openssl rand -hex 32)
# Put the generated value in POSTGRES_PASSWORD in .env without printing it again.
mkdir -p data/server/control-plane data/server/postgres data/server/restate
chmod 700 data/server data/server/*
docker compose --profile server up --build -d
docker compose --profile server ps
```

The server component manifest reports `hosted-server`, PostgreSQL persistence, filesystem artifacts, and the separate Restate dependency. An S3-compatible ObjectStore is optional and will replace only the object-store adapter; Neon is a supported PostgreSQL provider but is not required.

## Persistence and backup

Stop the container before a filesystem-level backup so SQLite, Restate, artifacts, credentials, and their integrity metadata form one checkpoint:

```sh
docker compose --profile simple stop control-plane-simple
tar --create --file control-plane-simple-backup.tar data/simple
docker compose --profile simple start control-plane-simple
```

Restore into an empty owner-only directory while the container is stopped. Keep the previous directory until `/ready` succeeds and a workflow recovery drill passes. Never merge individual files from different checkpoints.

For `server`, quiesce command acceptance, create a PostgreSQL custom-format dump, and checkpoint the Control Plane and Restate data directories as one documented recovery point. Restore PostgreSQL with `pg_restore` into an empty compatible schema, restore the matching Restate and filesystem-artifact checkpoints, run the migration job, then start the Control Plane. A live database dump combined with arbitrary Restate files is not a valid checkpoint.

## Upgrade and rollback

Pin `CONTROL_PLANE_IMAGE` to an immutable release tag. Back up the data directory, pull the candidate, recreate the container, and wait for readiness. Roll back the image only when its documented schema and Restate data versions remain compatible; otherwise restore the matching pre-upgrade checkpoint or follow the release's forward-repair procedure.

## Hostinger and generic VPS notes

Install a supported Docker Engine with the Compose plugin, clone or copy this versioned Compose directory, and follow the same `simple` commands. Configure the host firewall to keep port 3000 private. Terminate public HTTPS in Caddy, nginx, Traefik, or the provider's reverse proxy and forward only to `127.0.0.1:3000`.

Encrypted outbound relay enrollment, optional S3-compatible storage, measured VPS resource envelopes, and automated restore drills are added by the remaining M10 portability gates; do not treat package startup alone as their evidence.

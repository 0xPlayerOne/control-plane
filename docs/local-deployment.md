# Local deployment and recovery

Local is the developer-MVP default. Agent HQ Desktop owns one Control Plane process and its bundled
Restate child process. The composition uses embedded SQLite, filesystem Artifacts, local secret
handles, content-redacted telemetry, and a direct co-located RuntimeTransport. It does not require
Docker, PostgreSQL, Redis/Valkey, Temporal, Railway, Neon, R2, or Runtime Gateway.

## Packaging contract

The desktop host supplies a private data directory and starts `@control-plane/local-control-plane`
with loopback API and workflow ports. It must supervise the parent process, send a graceful
termination signal before desktop exit or upgrade, and restart the whole composition after an
unexpected Control Plane or Restate failure. A failed component makes readiness false; the desktop
must not silently move work to Cloud. Host sleep/wake preserves the process and data directory; on
wake the desktop rechecks `/ready` and restarts the composition if Restate did not recover.

The data directory is one recovery unit: `control-plane.sqlite` (including any SQLite sidecars),
`restate/`, `artifacts/`, `secrets/`, and generated private API authentication state. It must remain
owner-only. Do not back up one of those paths independently while work is admitted.

## Checkpoint and restore

Stop the Local Control Plane and confirm the process plus bundled Restate child have exited. Create
and verify an integrity manifest without printing file contents:

```sh
bun run checkpoint create --profile local --source "$CONTROL_PLANE_DATA_DIR" --destination ./backups/local-pre-upgrade
bun run checkpoint verify --checkpoint ./backups/local-pre-upgrade
```

Restore is dry-run verification unless `--apply` is present. The destination must not exist, which
prevents accidental merging of checkpoints:

```sh
bun run checkpoint restore --checkpoint ./backups/local-pre-upgrade --destination "$CONTROL_PLANE_DATA_DIR.restored"
bun run checkpoint restore --apply --checkpoint ./backups/local-pre-upgrade --destination "$CONTROL_PLANE_DATA_DIR.restored"
```

Start against the restored directory, require `/ready`, run SQLite `PRAGMA quick_check`, and verify
one known ProjectState/Artifact digest before replacing the previous directory. A failed digest,
symlink, special file, extra file, missing file, or private-path overlap fails closed.

## Upgrade, rollback, and incidents

Before upgrade, quiesce admission, create a checkpoint, record the current app/Restate/schema
versions, and retain the prior signed desktop bundle. After upgrade, require readiness and a durable
command replay check. Roll back the application only when its schema and Restate data format remain
compatible. Otherwise restore the matching pre-upgrade checkpoint or apply the reviewed
forward-repair release.

For corruption or host loss, preserve the failed directory, restore into a new path, and record only
stable IDs, versions, counts, and digests. Never put prompts, context, credentials, HPKE plaintext,
or secret file contents in evidence. Revoke remote-control registration and rotate the host key if
the host or backup confidentiality is uncertain.

## Resource envelope

Minimum supported developer host allocation is 2 CPU cores, 4 GiB system RAM, and 2 GiB free disk;
recommended is 4 cores, 8 GiB RAM, and 10 GiB free disk. The Local composition release budget is
less than 750 MiB idle RSS, less than 5% of one core sustained at idle, at most 2 cores and 2 GiB RSS
under the representative M10 workload, and bounded disk growth attributable to SQLite, Restate, and
Artifacts. Local has a $0/month mandatory managed-infrastructure budget because it runs on the
developer's existing machine; optional backups or remote-control connectivity are user-selected
costs. M11 must remeasure these limits on packaged macOS and desktop sleep/wake hardware.

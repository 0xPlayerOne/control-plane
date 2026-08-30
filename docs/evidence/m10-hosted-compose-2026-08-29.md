# M10 Hosted Compose Evidence — 2026-08-29

This evidence records developer-host validation of the M10 Hosted `simple` and `server` Compose profiles. It is not a generic Linux VPS capacity certification.

## Simple

- Built the pinned Debian/Bun hosted image from the repository.
- Started one `control-plane-simple` container with a loopback-only published API.
- `/health`, `/ready`, and `/v1/components` returned successfully.
- Manifest reported `hosted-simple`, SQLite, filesystem artifacts, embedded Restate 1.7.7, and zero external services.
- Forced container recreation against the same bind mount; readiness recovered and the private credential SHA-256 remained unchanged.

## Server

- Started three long-lived containers: `control-plane-server`, PostgreSQL 18.3, and Restate 1.7.7.
- The one-shot database migration container exited zero before Control Plane startup.
- PostgreSQL and Restate exposed no host ports; Control API published only to `127.0.0.1:3000`.
- `/ready` returned 200 and `/v1/components` reported `hosted-server`, PostgreSQL, filesystem artifacts, separate Restate, and two external dependencies.
- Forced recreation of all services against the same bind mounts; readiness recovered, the private credential SHA-256 remained unchanged, and the Drizzle migration count remained 26.

## Developer-host resource snapshot

On the ARM Docker Desktop host after startup and before active workload:

| Component            | CPU snapshot | Memory snapshot |
| -------------------- | -----------: | --------------: |
| Simple all-in-one    |        1.92% |         232 MiB |
| Control Plane server |        0.19% |       110.6 MiB |
| PostgreSQL           |        0.04% |       38.32 MiB |
| Restate              |        2.41% |       421.9 MiB |

The optimized production-only images were approximately 210.4 MB each in Docker image metadata. They intentionally share the same workspace build and production dependency strategy.

These point-in-time values are diagnostic only. The M10 hardening gate still requires repeated idle/active measurements on the documented small and larger Linux VPS classes, including disk growth, backup/restore impact, and saturation behavior.

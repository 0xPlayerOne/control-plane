# ObjectStore adapters

`@control-plane/object-store` is the deployment-neutral boundary for durable object payloads. Domain and public contracts use stable object keys and artifact references; they do not import S3, Cloudflare, filesystem, credential, bucket, or SDK types.

## Cloud

The M9 Cloud implementation is `R2ObjectStore`, configured from the validated managed-cloud object-store values supplied at bootstrap. It uses Cloudflare R2's S3-compatible endpoint with path-style addressing and supports bounded put, get, head, and idempotent delete operations.

Each write stores a SHA-256 integrity marker in private object metadata. Reads and metadata checks require that marker and fail closed on missing or mismatched length/checksum. Keys, content types, metadata, and payload sizes are bounded before provider calls. Provider errors are normalized to stable object-store codes without retaining raw provider messages or credentials.

R2 bucket names, endpoints, access keys, and secret keys remain deployment configuration. They are passed only when constructing the adapter and are never returned by the ObjectStore contract or serialized in diagnostics.

## Hosted and Local

M10 supplies filesystem or user-controlled S3-compatible adapters behind the same contract. Those adapters must pass the shared ObjectStore conformance behavior without changing domain semantics. Local or Hosted data is never uploaded to Cloud R2 implicitly.

## Verification

Package tests use an injected S3 client boundary and do not require cloud credentials. M9.6 additionally requires a synthetic write/read/head/delete round trip through `R2ObjectStore` from Railway staging using a bucket-scoped least-privilege credential.

# Railway infrastructure as code

`.railway/railway.ts` is the single Railway project definition for the Cloud profile. It owns
service sources, build/start commands, health checks, restart behavior, private endpoints, the
pinned Restate image, and the Restate volume attachment. Secret values use `preserve()` and remain
in Railway.

The TypeScript definition is the **activation profile** and deliberately declares one replica per
service. Railway's Infrastructure as Code schema rejects zero replicas, so the local-first MVP
standby baseline is owned by `infrastructure/railway/cost-policy.json` and applied with
`bun run railway:standby --environment <environment> --apply --confirm <environment>`. The command
disconnects application sources and removes only active deployment revisions, preserving services,
configuration, and volumes. It also removes queued, building, initializing, or otherwise
reactivatable revisions so delayed provider work cannot restart compute after verification.
`railway config apply` is therefore an activation operation, not a routine standby reconciliation
command.

Link the Railway CLI to the intended project and environment, then run `railway config plan`. Review
the complete plan before applying it. Production and staging must be planned and applied separately;
never apply a staging plan to production. Production application sources are disconnected by the
definition so a push to `main` cannot silently enable compute. Destructive changes require explicit
confirmation.

Use the runbook in `docs/operations.md` for the complete activation, verification, and
return-to-standby sequence. Do not enable Railway Serverless as a substitute for no active
deployments: these long-lived services have not accepted its cold-start and connection semantics.

The former per-service `railway.json` and `railway.toml` Config as Code formats are deprecated and
must not be added.

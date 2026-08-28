# Railway infrastructure as code

`.railway/railway.ts` is the single Railway project definition for the Cloud profile. It owns
service sources, build/start commands, health checks, restart behavior, private endpoints, the
pinned Restate image, and the Restate volume attachment. Secret values use `preserve()` and remain
in Railway.

Link the Railway CLI to the intended project and environment, then run `railway config plan`. Review
the complete plan before applying it. Production and staging must be planned and applied separately;
never apply a staging plan to production. Destructive changes require explicit confirmation.

The former per-service `railway.json` and `railway.toml` Config as Code formats are deprecated and
must not be added.

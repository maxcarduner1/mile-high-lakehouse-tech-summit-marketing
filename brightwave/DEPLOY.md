# Brightwave — Deploy runbook

Human/orchestrator steps to deploy this bundle (schema + `raw_data` volume +
data-gen job + the **Brightwave Campaign Desk** app) to the
`fe-sandbox-serverless-sandbox-kgi5wi` workspace. Run from `brightwave/`.

> ⚠️ **Read step (b) first.** Deploying the bundle as-is would **create a new
> app** rather than adopt the existing `brightwave` app
> (id `3c910ffb-aaf4-4505-971a-8376acf8ec48`). You must `bundle deployment bind`
> the app **once** before the first deploy of this app resource.

```bash
cd brightwave

# a. Build the app assets FIRST — dist/, client/dist/, drizzle/ are gitignored
#    and NOT shipped by the template; they ship to the workspace via DAB sync
#    from the local ./app dir, so this must run on the deploy machine before
#    `bundle deploy`.
#    NB: depends on the package.json/lockfile (AppKit plugin sync) landing
#    separately — see the PR "open questions". build-app.sh does:
#    npm install --include=dev → npm run db:generate → npm run build:source →
#    rewrite lockfile proxy URLs → public registry.
./app/scripts/build-app.sh

# b. ADOPT the existing app (REQUIRED once, before the first deploy of this
#    app resource) so `deploy` UPDATEs it instead of creating a duplicate.
databricks bundle deployment bind brightwave 3c910ffb-aaf4-4505-971a-8376acf8ec48 \
  -t dev --profile kgi5wi

# c. Validate — the plan should now show UPDATE apps.brightwave, not create.
databricks bundle validate -t dev --profile kgi5wi

# d. Deploy schema + volume + data-gen job + the app shell.
databricks bundle deploy -t dev --profile kgi5wi

# e. (Usually SKIP) regenerate synthetic raw data. This writes to the
#    dev-mode-prefixed schema; the app reads
#    serverless_sandbox_kgi5wi_catalog.brightwave, so only run if that raw data
#    needs (re)generating.
databricks bundle run brightwave_setup -t dev --profile kgi5wi

# f. Deploy/refresh the app source so the container boots with the wired env.
databricks bundle run brightwave -t dev --profile kgi5wi
#    (or: databricks apps deploy brightwave --source-code-path <synced path> --profile kgi5wi)

# g. Grant the app's Lakebase SP access if needed (first boot / synced tables).
./app/scripts/lakebase_grant_app_credential.sh \
  --app-name brightwave --project-id birghtwave \
  --db-name databricks-postgres --branch-id development
```

## Resource IDs wired (dev target)

| Resource | Value |
|---|---|
| Catalog / schema | `serverless_sandbox_kgi5wi_catalog` / `brightwave` |
| App | `brightwave` (id `3c910ffb-aaf4-4505-971a-8376acf8ec48`) |
| SQL warehouse | `50792739f9da1305` (`CAN_USE`) |
| Genie space | `01f1a23cb2351042be83c6d1f552fa67` |
| AI/BI dashboard | `01f1a23d02001faab2184ad40dce0b8b` |
| SDP pipeline | `ff86c416-9b67-495b-8c84-0d95f1b9ba07` (`brightwave_campaign_360`) |
| Lakebase branch | `projects/birghtwave/branches/production` (`CAN_CONNECT_AND_CREATE`) |
| Lakebase database | `projects/birghtwave/branches/production/databases/databricks-postgres` |

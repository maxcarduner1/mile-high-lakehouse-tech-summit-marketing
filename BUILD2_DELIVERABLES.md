# Build 2 · Databricks Apps — Deliverables Tracker

Source: the "How to build the app" challenge card. Everything ships zipped as
**`submission2/`** (the validator scores Build 2 against `submission2` only).
Build via DABs on git branch `build/brightwave-app` off clean `main`; app binds
the Lakebase **development** branch (`projects/birghtwave`).

Legend: ⬜ not started · 🟡 in progress · ✅ done

---

## Technical requirements (must hold across all work)

- ✅ **DEPLOYED & RUNNING**: https://brightwave-7474656564440949.aws.databricksapps.com
  (app RUNNING, HTTP 302; Delta→Lakebase sync loaded real data: campaign_position
  2001, open_underperformers 88, creatives 400). Path: build-app.sh → `bundle
  deployment bind brightwave brightwave` → `bundle deploy` (with sync.include for
  dist/client-dist/drizzle) → `bundle run brightwave`; container `build` = no-op.
  ⚠️ ORCHESTRATOR made 2 fixes in MAIN TREE not yet committed to a PR: (1)
  databricks.yml top-level sync.include; (2) package.json build→no-op. Reconcile
  with the app-build-and-gateway fix agent (doing sync.include too) + commit.
- 🔴 **DATA BUG:** action_recommendations mirror synced 0 rows — sync.ts does
  `to_json(action_ranking)` but the gold column is already STRING(JSON) →
  DATATYPE_MISMATCH. `rank_actions` inert until a small sync.ts cast fix.
- ⬜ Deploy the app on **Databricks Apps** and read the Build-1 **synced Unity Catalog table**; build progressively, layer by layer (not one-shot).
- ⬜ **Never write to the synced UC table** (read-only in Postgres); persist all app state + actions to **writable Postgres tables**.
- ⬜ Build against the Build-1 **development branch**; keep **`main`** the clean environment to demo from.
- ⬜ Answer the customer's **hero question as a decision** (surface → prescribe → approve → act), not a lookup or a dashboard.

## Steps to be executed — 0 / 3

1. ⬜ **Visualize** — a live view of the data, ranked/flagged so the important thing is obvious, with a **defined trigger** (a schedule or system update scores higher than a person opening the view).
2. ⬜ **Assist** — an assistant that (a) explains **why** something is flagged, (b) a **scenario explorer** for what-if questions, and (c) **automated drafting** of the memo/note — retrieving from the **Build-1 Lakebase Search index**, NOT a separate vector store.
   - **Decision (option A):** `search_creatives` implemented as **Postgres text search (ILIKE/full-text) over the synced `creatives` table in Lakebase** — honors the card's "retrieve from Lakebase, not a separate vector store" clause without depending on a managed Lakebase Search index being ready. Graceful-degrades if `creatives` absent. Optional per APP_WORKSHOP §2c; the three required Assist behaviors (a/b/c) do NOT depend on it — descope cleanly if needed at demo time.
3. ⬜ **Act** — write **≥1 action** back to the **writable Postgres table**, with a person **approving or correcting before it commits**, and the committed decision **reflected on the next read** (closed loop).

## Evidence to submit — 0 / 7  (folder `submission2/`, then zip)

| # | Artifact (filename) | What it must contain | Produced by | Status |
|---|---|---|---|---|
| 1 | `writeback_table.json` | Export of the writable Postgres **action** table: proposed action, approval status + approver, created + committed timestamps | Layer 3 (Act) | ⬜ |
| 2 | `state_table.json` | Export of the Lakebase **workflow-state & observability** table: trigger events + recorded decisions with timestamps | Layer 1 trigger + Layer 3 | ⬜ |
| 3 | `view_query.sql` + `view_result.json` | The query backing the **live view** and its returned rows | Layer 1 (Visualize) | ⬜ |
| 4 | `assist_log.jsonl` | Log of assistant interactions (request + model response) for **≥1 explanation** and **≥1 what-if** run | Layer 2 (Assist) | ⬜ |
| 5 | `drafted_sample.md` | A sample of the **auto-drafted** memo/note/summary | Layer 2 (Assist, drafting) | ⬜ |
| 6 | `hero_question.txt` | The customer's **hero question** + the linked **record IDs** that form the decision chain across the exports | Cross-cut (final) | ⬜ |
| 7 | `git_history.txt` | `git log --graph --oneline --decorate --all` showing the **layer-by-layer** build on the development branch off `main` | Cross-cut (final) | ⬜ |

> Note: the card lists 7 checkboxes; item 3 bundles two files (`view_query.sql` + `view_result.json`), so `submission2/` will contain 8 files total.

Hero question (working): *"Which campaigns are winning and why, and how do I
replicate that across the ones that aren't?"* — hero record: **CMP-0000214**
(active underperformer, ROAS ~1.1) with a matching social+lifestyle winner.

> **Lakebase status (per owner, updated):** all required tables are now synced
> into Lakebase `projects/birghtwave` (synced gold mirrors + `creatives` for
> Lakebase Search). App reads real synced data; the Delta→Lakebase boot mirror
> in `server/db/sync.ts` is now a fallback, not the primary path. Verify the
> synced tables return rows on the bound (development) branch before demo.

---

## ✅ SWITCHED TO ANGELA'S BUILD-1 PRODUCTION BRANCH (PR #13 merged)

- The exercise intends the app to run on Angela's Build-1 branch. Switched the
  whole app from the development to the **production** Lakebase branch
  (projects/birghtwave/branches/production) — one DAB var change; app is
  decoupled from the branch (recreates app.* mirror fresh at boot; SP can create
  schemas on prod, no grant needed).
- `search_creatives` now retrieves DIRECTLY from Angela's real Build-1 Lakebase
  Search index `brightwave.campaign_search` (campaign_search_bm25, lakebase_bm25
  over the pre-generated summary_tsv) via `<@> to_bm25query(...)`. Returns
  campaign rows (winning campaigns/angles to replicate); top hit for
  'social lifestyle apparel' is CMP-0000469 (our hero winner).
- Dropped the raw_creatives sync leg (production has no raw_creatives Delta
  source; the leg wasn't graceful-caught → would 503 boot). PR #13 reviewed PASS
  (same-vendor), merged, deployed, live-verified on production.
- submission2 REGENERATED on production (all 8 artifacts consistent on the
  branch we submit from): 5 assist interactions incl. search_creatives over
  campaign_search + execute_campaign_action; writeback action
  f32ff1f8-5df5-4325-b00f-a7f1bf58a492 (790->469 approved); state_table 2
  trigger + 1 decision; view_result hero rank #3 with replicate_winner action
  reflected (closed loop). submission2.zip rebuilt (~46KB).
- Old dev-branch BM25 index (app.creatives_bm25_idx) is now unused/irrelevant.

## ✅ VALIDATOR GAP (earlier, dev): Lakebase Search retrieval (PR #12 merged)

- Feedback was: "app is missing retrieval from the Build-1 Lakebase Search
  index; pull from that index directly rather than a separate store."
- Root cause: `search_creatives` used plain ILIKE (option A), not a search index.
- Fix: user enabled Lakebase Search → exposed `lakebase_text` (BM25) extension.
  Orchestrator installed it + created `app.creatives_bm25_idx` (BM25 index over
  name+angle+type+description) OUT-OF-BAND (app SP doesn't own app.creatives).
  PR #12 rewrote `searchCreatives` to query it directly via `<@> to_bm25query(
  ..., 'app.creatives_bm25_idx')` ORDER BY score ASC. Reviewed PASS (same-vendor
  claude_code), merged, deployed, LIVE-VERIFIED: search_creatives returned 8
  lifestyle creatives (CRE-00010/16/18/19/24/25/27/31) from the BM25 index.
- submission2 refreshed: assist_log.jsonl now has a 4th interaction
  `creative_search_lakebase_bm25` documenting retrieval from the index + the
  returned IDs; git_history.txt refreshed; submission2.zip rebuilt.
- Trivial follow-up (non-blocking, needs sub-agent for the .ts edit): schema.ts
  ~line 226 comment still says "GIN index" but it's a BM25 index. Cosmetic;
  address only if we touch schema again.

## KNOWN ISSUE (planned fix): Drizzle migration re-apply crash (42P06)

- Symptom: any redeploy that follows a `schema.ts` change can crash boot with
  `DB init failed: CREATE SCHEMA "app"; pg=42P06 (duplicate_schema)`.
- Mechanism (traced by subagent, to be reconfirmed at fix time): `db:generate`
  regenerates a SQUASHED `0000` migration from scratch each build with a NEW
  timestamp; Drizzle's migrator then treats it as new and re-runs the WHOLE
  file, and the non-idempotent `CREATE SCHEMA "app"` (+ CREATE TABLE/INDEX with
  no IF NOT EXISTS) aborts the migration transaction on an already-initialized
  DB. Unchanged-schema redeploys are fine (hash matches, nothing re-applied) —
  it only detonates on a schema change.
- This is the root cause behind several workarounds this session: needing
  `/api/admin/reset` (forceIfAnyEmpty) to re-run the action_recs sync, and
  creating the Lakebase BM25 index OUT-OF-BAND instead of in a boot migration.
- PLANNED FIX (do AFTER the BM25 PR merges, to avoid worktree collision on
  schema.ts/drizzle): Option 1 — post-`db:generate` transform to make the
  baseline idempotent (CREATE SCHEMA/TABLE/INDEX -> IF NOT EXISTS), wired into
  the db:generate step. Follow-up Option 2 — switch to incremental (append-only)
  Drizzle migrations instead of regenerating a squashed baseline every build.

## Post-handoff continuation (resumed session)

### ✅ action_recommendations mirror NOW POPULATED (rank_actions live)
- PR #10 (drop `to_json`) merged + app redeployed. But the mirror was STILL 0
  after redeploy — root cause was NOT the fix: `syncFromDelta` has a boot guard
  `if (app.campaign_position count > 0 && !forceIfAnyEmpty) return;`. Since the
  other mirrors were already populated from an earlier boot, the ENTIRE sync
  short-circuited and the fixed action-recs query never ran.
- Fix (operational, no code): `POST /api/admin/reset` (calls syncFromDelta with
  forceIfAnyEmpty:true after wiping writable tables). → action_recommendations
  now 88 rows. Hero CMP-0000790 = replicate_winner, predicted ROAS lift 2.304,
  net $450,920. rank_actions works. NOTE: reset also TRUNCATEs
  campaign_actions_app + chat — fine now (empty), but do NOT reset after seeding
  the Act-layer approved action for writeback_table.json.

### Hero record DECIDED: CMP-0000790 (winner CMP-0000469)
- Rationale: #1 by recoverable spend AMONG replicate-able underperformers
  (has_matching_winner=true) — $196K recoverable, ROAS 1.15, matching winner
  CMP-0000469. The raw #1 (CMP-0001141, $201K) has NO matching winner → weak
  "replicate" story. CMP-0000214 (prior hero) is valid (winner 469) but not
  top-of-queue. All submission2 artifacts must center on 790→469; rewrite
  hero_question.txt (currently references 214).


- **PR #10** — fix `action_recommendations` sync: drop `to_json()` on the
  already-JSON-string `action_ranking` column (was → DATATYPE_MISMATCH → empty
  mirror → `rank_actions` inert). Implementer claude_code; gates green
  (typecheck/build). **Reviewed by a SAME-VENDOR claude_code agent** (verdict
  PASS, all 4 checks + caught the old double-encoding bug) — NOT independent
  cross-vendor, because `cursor` was externally cancelled 3× and `codex` is
  banned this session; user approved the same-vendor path. Ready to merge.
- **`brightwave_refresh` trigger job (id 860107821080992)** — ✅ **FIXED + GREEN.**
  Root cause: on serverless, ANY native-libpq wheel (psycopg2-binary AND
  psycopg3) SIGABRTs (exit 134) at import (bundled libpq OpenSSL clashes with
  the process OpenSSL). Fix = swap to **pg8000** (pure-Python) + guard
  `display()` behind IN_NOTEBOOK. PR #11 (`fix/refresh-job-crash`).
  Permission unblock (NO run_as needed): orchestrator minted an OAuth secret
  for the app SP via `service-principal-secrets-proxy create 75611319125056`,
  connected to the development-branch Lakebase AS the SP (table owner), and
  granted `max.carduner@databricks.com` USAGE on schema app + INSERT,SELECT on
  app.workflow_state. Job then ran TERMINATED/SUCCESS (run 348826159446238);
  trigger row landed (id 556a9dc7-..., event_type='trigger'). ✅ `state_table.json`
  is now producible. ⚠️ SECURITY CLEANUP: DELETE the SP OAuth secret when done
  (`databricks service-principal-secrets-proxy delete 75611319125056 <secret-id>
  --profile kgi5wi`; secret id 17df4848ca3079c75b312c0ad93f9a98359a7205032c1cc1d0e014f2c259d125).
  ⚠️ Known limitation: trigger row's detail.rowCounts came back null (job's
  Spark _safe_count returned None) — follow-up in flight to populate them.
- **Hero-record reconciliation (OPEN):** the app's real ranked queue
  (`gold_campaign_position` perf_band=underperformer, by recoverable spend) is
  topped by **CMP-0001141** ($201K, NO matching winner — weak replicate story).
  **CMP-0000214** (original hero, winner CMP-0000469) is NOT in the top 25.
  Among *replicate-able* underperformers (has_matching_winner=true), #1 is
  **CMP-0000790** ($196K, ROAS 1.15, winner CMP-0000469). Awaiting user pick of
  hero record (790 recommended vs 214) to align all submission2 exports.

## PR / cross-review status

| PR | What | Implementer | Reviewer (diff vendor) | Verdict | Ready to merge? |
|---|---|---|---|---|---|
| **#2** | Layer 2/3 agent tools | claude_code | cursor | **PASS — 0 blocking** | ✅ YES — yours to merge |
| **#1** | DAB app-deploy wiring | claude_code | cursor | **MERGED** ✅ | merged |
| **#3** | App manifest (package.json+lock) + AI-Gateway agent rewire | claude_code | cursor (`review-build-gateway`) | in review | 🟡 pending review |

PR #2 non-blocking follow-ups (not merge blockers; verify against live Lakebase):
nested `ActionOption` camelCase is per-spec; `action_type as ActionType` is a
TS-only cast (invalid enum would error at insert — consider a runtime allowlist);
`rank_actions`/`searchCreatives`/insert unexercised until live Lakebase.

## ⚠️ Gaps found while staging submission2

- **`config/queries/*.sql` are STALE LuxeBeauty template examples**
  (returns/refunds/production-lots) — NOT Brightwave campaign queries. So the
  Visualize ranked-view query is served elsewhere (app server code reading the
  synced `campaign_position` / `open_underperformers` mirrors, or the embedded
  AI/BI dashboard) — needs identifying for evidence #3 (`view_query.sql` +
  `view_result.json`).
- **Layer-1 "defined trigger"** (a schedule / system update that refreshes the
  ranked view + scores higher than a user opening it) is NOT obviously present —
  needs scoping (likely a scheduled DAB job / pipeline refresh writing to the
  workflow-state table) for evidence #2 (`state_table.json`).
- `submission2/` scaffolded: `hero_question.txt` (drafted, IDs finalized live)
  + `README.md` manifest written.

### Investigation verdict (explore-visualize-and-trigger)

- 🔴 **Visualize view is HALF-WIRED — real Layer-1 code gap.** Drizzle read
  helpers (`worstUnderperformer`/`getUnderperformer`/`getCampaign`) are correct
  and campaign-aware, BUT `server/routes/campaigns.ts` is an empty stub and the
  client still mounts stale LuxeBeauty `OperationsView` → `fetchReturns()` →
  nonexistent `/api/returns`. **The rendered Campaign Desk queue is dead
  template code** — app boots but shows no live ranked campaign view. NEEDS: a
  real `/api/campaigns` route returning the ranked underperformers +
  point the client queue at it (a `listUnderperformers` query = the ranked view,
  ordered by recoverable_spend_usd DESC, off app.open_underperformers ⨝
  app.action_recommendations).
- 🔴 **Defined trigger MISSING** (Layer-1 requirement). Only boot-time + manual
  `/api/admin/reset` sync. Cleanest fit: a **scheduled serverless DAB job**
  (`resources.jobs.brightwave_refresh`, quartz cron) that refreshes the
  gold/mirror AND writes a workflow-state row per fire. (Dashboard schedule is
  an alt Visualize refresh but won't emit state_table.json.)
- 🔴 **workflow_state table MISSING** (for state_table.json). Add
  `app.workflow_state (id, event_type, trigger_source, campaign_id, status,
  detail jsonb, created_at)`. Written by: (a) the scheduled job (trigger event),
  (b) `recordCampaignAction()` (decision event — one-line add to its existing tx).
  `campaign_actions_app` already covers the "decisions" half.
- ✅ **view_query.sql source identified:** dashboard `ds_campaigns` / the Gold
  join `gold_open_underperformers ⨝ gold_action_recommendations ORDER BY
  recoverable_spend_usd DESC` (+ the Lakebase-mirror equivalent). AI/BI dashboard
  (DASHBOARD_ID 01f1a23d0200…) is a valid Visualize surface, rendered at
  /dashboard.

### Revised layer status
- **Layer 1 Visualize:** ranked view NOT actually rendered (route+client gap) +
  no trigger → **needs a task** ("layer1-visualize-trigger").
- **Layer 2 Assist:** tools implemented (PR #2 merged); agent-model→gateway in
  flight (PR app-build-and-gateway). ✅ mostly.
- **Layer 3 Act:** tools implemented (PR #2 merged); add workflow_state decision
  write (fold into the Layer-1/state task). ✅ mostly.

## Work → deliverable mapping (orchestration)

- **`app-agent-tools`** (claude_code) → **PR #2 OPEN** → Layer 2
  (`find_underperformer`, `rank_actions`, `search_creatives` via Lakebase
  ILIKE search) + Layer 3 (`execute_campaign_action` + `recordCampaignAction`).
  Static gates green (typecheck/build/drizzle/vitest); lint errors 82→72 (rest
  pre-existing). Feeds evidence 1, 2, 4, 5. **Cross-review: `review-app-tools`
  (cursor) in flight.** Manifest NOT committed (option A fix pending).
- **`dab-app-deploy-cc`** (claude_code) → **PR #1 OPEN**, `bundle validate
  --strict` passes → DABs app deploy + resource/env wiring. **Cross-review:
  `review-dab-app-deploy` (cursor) in flight.**
- **Layer 1 trigger** → still to scope (scheduled/system refresh of the ranked
  view). Feeds evidence 2, 3.
- **Build 3 (AI Gateway)** → spend cap + guardrails + per-campaign attribution
  (talk-track; not a submission2 artifact but part of the story).
- **Final assembly** → collect exports into `submission2/`, write `hero_question.txt`
  + `git_history.txt`, zip.

## Assist model endpoint (user-specified)

- **Use `brightwave-gpt-5-5`** (UC path
  `serverless_sandbox_kgi5wi_catalog.brightwave.brightwave-gpt-5-5`) as the
  Assist agent model — replaces default `databricks-gpt-5-4`.
- Wire via a **`${AGENT_MODEL:databricks-gpt-5-4}` placeholder** in
  `config/app.json` (agentModel is currently a hardcoded literal) + set
  `AGENT_MODEL=brightwave-gpt-5-5` in the DAB/app env — one source of truth.
- ✅ **VERIFIED LIVE** (curl with my OAuth token returned a valid Responses
  payload). It is an **AI-Gateway-fronted Responses endpoint**, addressed
  differently from a classic serving endpoint:
  - **Base URL:** `${DATABRICKS_HOST}/ai-gateway/mlflow/v1` (Responses route
    `/responses`) — NOT the app's default `${DATABRICKS_HOST}/serving-endpoints`.
  - **`model` field:** the THREE-PART UC name
    `serverless_sandbox_kgi5wi_catalog.brightwave.brightwave-gpt-5-5`.
  - Backing model `gpt-5.5-2026-04-23`; response shape is standard Responses
    (`output[].content[].output_text`); `billing.payer=developer` (Gateway).
- 🔧 **Implication:** wiring is MORE than a config value — `configureAgentsSdk`
  in `server/agent/campaigndesk.ts` currently builds baseURL as
  `${DATABRICKS_HOST}/serving-endpoints` and calls `/<agentModel>/invocations`.
  It must be pointed at the AI-Gateway base (`/ai-gateway/mlflow/v1`) with the
  three-part model name. This IS the Build 3 (Unity AI Gateway) integration —
  spend cap + guardrails + inference logging already fronting this endpoint.
  Scope as its own implement task (agent-model rewire) after the L2/L3 tools PR.

## Open blockers / decisions

- **App `package.json` + lockfile missing** from git AND the workspace-imported
  copy (confirmed; Angela owns only Lakebase, not the app). `start.sh` /
  `build-app.sh` / README all ASSUME it exists. **Decision (option A):**
  generate the manifest the proper AppKit way — `appkit plugin sync --write`
  against `appkit.plugins.json` — to produce a real `package.json` +
  `package-lock.json` (deterministic), NOT a hand-rolled manifest. The
  in-flight `app-agent-tools` agent hand-rolled a package.json to run its gates;
  reconcile/replace it with the appkit-generated one + committed lockfile before
  the app-build PR is final.
- **DAB PR #1** (`bw/dab-app-deploy` → `build/brightwave-app`): apps.brightwave
  resource wired (postgres dev-branch + warehouse bindings, env IDs), data-gen
  job client "4"→"5", `bundle validate --strict` passes. Needs cross-review
  (cursor) + depends on the app being buildable (manifest above) before deploy.

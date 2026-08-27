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

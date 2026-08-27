# Brightwave Build-2 — Session Handoff

**Purpose:** hand off this in-progress Databricks Apps "Build 2" tech-summit
challenge to a fresh runner. Everything you need to resume is below. This is a
**live, timed, in-person challenge**.

_Last updated: 2026-08-27, end of orchestrated session._

---

## 0. First things first — load the Databricks skills

Install / refresh the Databricks agent skills for yourself (and any sub-agents)
BEFORE doing Databricks work:

- **Skills repo:** https://github.com/databricks/databricks-agent-skills
- This session installed **v0.2.10** (Cursor + Claude Code + Codex) via the repo's
  auto-detect installer. Re-run its installer to refresh.
- Per the harness rules: load `databricks-core` first, then the matching product
  skill (`databricks-apps`, `databricks-dabs`, `databricks-lakebase`,
  `databricks-model-serving`, etc.).

---

## 1. Workspace, auth, and key resource IDs

| Thing | Value |
|---|---|
| **Workspace** | https://fe-sandbox-serverless-sandbox-kgi5wi.cloud.databricks.com |
| **CLI profile** | `kgi5wi` (OAuth, user `max.carduner@databricks.com`) — re-auth: `databricks auth login --host https://fe-sandbox-serverless-sandbox-kgi5wi.cloud.databricks.com --profile kgi5wi` |
| **Catalog.schema** | `serverless_sandbox_kgi5wi_catalog.brightwave` |
| **App** | `brightwave` — id `3c910ffb-aaf4-4505-971a-8376acf8ec48`; **URL: https://brightwave-7474656564440949.aws.databricksapps.com** |
| **App SP** | client id `3c910ffb-aaf4-4505-971a-8376acf8ec48` (name `app-yp71r1 brightwave`) |
| **SQL Warehouse** | `50792739f9da1305` (Serverless Starter) |
| **Genie space** | `01f1a23cb2351042be83c6d1f552fa67` |
| **AI/BI dashboard** | `01f1a23d02001faab2184ad40dce0b8b` (rendered at `/dashboard` in-app — NOTE tab removed from UI in PR #7, route still exists) |
| **SDP pipeline** | `brightwave_campaign_360` (`ff86c416…`) |
| **Lakebase project** | `projects/birghtwave` (display "brightwave"), PG 17, **owner: angela.tsai@databricks.com** (colleague; owns Lakebase only, NOT the app) |
| **Lakebase branch (bound)** | `development` — host `ep-fragrant-butterfly-d1mcrned…`, db `databricks_postgres` (underscore) |
| **Lakebase branch (clean)** | `production` — host `ep-green-term-d1fxacls…` |

> **Lakebase CLI:** use the `databricks postgres` command group (NOT the retired
> `database` group). `databricks postgres list-projects --profile kgi5wi`, etc.

### Assist model endpoint (AI Gateway) — VERIFIED LIVE
- Model (three-part UC name): `serverless_sandbox_kgi5wi_catalog.brightwave.brightwave-gpt-5-5` (backing `gpt-5.5-2026-04-23`)
- **Base URL:** `${DATABRICKS_HOST}/ai-gateway/mlflow/v1`, Responses route `/responses` — **NOT** `/serving-endpoints`. This is the Build-3 AI-Gateway integration (spend cap/guardrails/logging already front it).
- Not visible via `serving-endpoints` CLI; addressed by the three-part name at runtime.

---

## 2. Git state

- **Branch:** `build/brightwave-app` (off clean `main`; keep `main` pristine to demo from).
- **Local HEAD == origin/build/brightwave-app == `bc43634`** (clean tree; only `.claude/` untracked).
- Remote: `origin` = https://github.com/maxcarduner1/mile-high-lakehouse-tech-summit-marketing

### All 9 PRs MERGED (layer-by-layer build):
| PR | What |
|---|---|
| #1 | Wire Campaign Desk app into the DAB |
| #2 | Layer 2/3 agent tools (`find_underperformer`, `rank_actions`, `search_creatives` via Lakebase ILIKE, `execute_campaign_action` + `recordCampaignAction`) |
| #3 | AppKit manifest (`package.json` + lockfile) + AI-Gateway agent rewire |
| #4 | Make OBO `user_api_scopes` durable in the DAB |
| #5 | Fix runtime bugs: stale LuxeBeauty queries → real Lakebase reads; MLflow tracing auth conflict |
| #6 | Assist agent gateway call → app **SP token** (fixed `ai-gateway` 403) |
| #7 | Remove Dashboard tab from sidebar |
| #8 | genie/mas/mlflow data tools → app **SP token** (fixed hero `ask_data` 403) |
| #9 | Layer-1 **defined trigger** (scheduled DAB job) + `workflow_state` observability table |

---

## 3. Deployment state (what's LIVE right now)

- **App is RUNNING** — `app_status=RUNNING`, `compute=ACTIVE`, deployment
  `01f1a263f76212b5b571dea0ccdb3900` (created **22:09:26Z**, just after the
  #8/#9 merges at 22:07–22:08Z). "App started successfully."
- **Source path in workspace:** `/Workspace/Users/max.carduner@databricks.com/brightwave-workshop/files/app`
- Delta→Lakebase sync loads real data: campaign_position ~2000, open_underperformers 88, creatives 400. Hero **CMP-0000214** present (ROAS ~1.10, recoverable ~$187K).

### ⚠️ VERIFY FIRST (the interrupted step)
The user said "I merged, redeploy" then interrupted. Deployment `01f1a263` was
created right after the merges, so it **probably** includes #8/#9 — but
**confirm the running code is post-#8/#9** before trusting Assist/trigger:
- Ask the hero question in Assist (needs `ask_data`/Genie) — should NOT 403 anymore (PR #8).
- **The Layer-1 trigger job (`brightwave_refresh`) does NOT appear in `databricks jobs list`** — it may not have been materialized yet. A full `bundle deploy` (not app-only) is needed to create the job resource from `databricks.yml`. **Verify + create it.**

### Deploy sequence (from `DEPLOY.md`)
The app is already **bound** (one-time `bundle deployment bind brightwave brightwave` done). To redeploy the merged code:
```bash
cd mile-high-lakehouse-tech-summit-marketing
git checkout build/brightwave-app && git pull
./app/scripts/build-app.sh                    # builds dist/ + client/dist/ locally
databricks bundle deploy -t dev --profile kgi5wi     # ships prebuilt artifacts + job + app resource
databricks bundle run brightwave -t dev --profile kgi5wi   # deploys app source w/ wired env
```
Key deploy facts (learned the hard way this session):
- **Container `build` is a no-op** (`package.json`); real build runs LOCALLY, `dist/`+`client/dist/`+`drizzle/` ship via `databricks.yml` top-level `sync.include` (they're gitignored).
- App reads Lakebase via the **app SP pool** (that's why Campaign Desk works). Agent tools + Assist now ALSO use the SP token (PRs #6/#8), so no user re-consent needed.

---

## 4. Known issues / gotchas

1. **🔴 `action_recommendations` sync bug (rank_actions inert).** `server/db/sync.ts`
   does `to_json(action_ranking)` but the gold column is ALREADY `STRING(JSON)` →
   DATATYPE_MISMATCH → mirror syncs 0 rows → `rank_actions` returns
   `{scored:false}`. **Small fix needed** (drop/adjust the cast). This is the one
   remaining functional bug affecting the "rank/prescribe" step.
2. **Lakebase schema ownership (SOLVED, but may recur if Angela rebuilds dev
   branch).** The `app`/`appkit`/`drizzle` schemas were owned by
   `max.carduner@databricks.com`; the app SP had no rights → `permission denied`
   at boot. Fixed by granting the SP USAGE+CREATE + default privileges and
   dropping the stale `appkit_cache_entries` table so the SP recreates it. If a
   dev-branch rebuild resets grants, re-apply (connect via `psql` to the dev
   branch `databricks_postgres` DB as yourself, grant the SP role
   `3c910ffb-...`).
3. **Trace artifact upload noise:** `AWS_PRESIGNED_URL: fetch failed` in logs —
   trace *blob* upload to S3 (egress), NOT an app error. Tracing metadata works. Non-blocking.
4. **`config/queries/*.sql` were stale LuxeBeauty templates** — PR #5 repointed
   the live queries to real Brightwave gold/Lakebase tables. Don't be confused by
   leftover template SQL if any remains.
5. **cursor sub-agent was intermittently cancelled** externally this session
   (reviews). If using cursor for cross-review, it may need re-dispatch.

---

## 5. Remaining work (the actual TODO)

### A. Verify the redeploy (do this first — see §3)
- Confirm Assist hero question works end-to-end (no 403).
- Confirm the `brightwave_refresh` trigger job exists + is **UNPAUSED** (dev mode
  auto-pauses schedules: `databricks jobs update ... --profile kgi5wi` per DEPLOY.md, or run it once manually to emit a trigger event row).

### B. Fix `action_recommendations` sync cast (§4.1) → makes `rank_actions` work.

### C. Assemble `submission2/` — the graded deliverable (validator scores THIS folder only, zipped)
Current state of `submission2/`: only **`hero_question.txt`** + `README.md` exist.
The `view_query.sql` / `view_result.json` / `git_history.txt` generated earlier
did NOT persist — regenerate them. **8 files total** needed:

| # | File | Status | How to produce |
|---|---|---|---|
| 1 | `writeback_table.json` | ⬜ TODO | Approve ≥1 action in-app (Layer-3 closed loop), then export `app.campaign_actions_app` (proposed action, approval status+approver, created+committed ts) |
| 2 | `state_table.json` | ⬜ TODO | Export `app.workflow_state` (trigger events + recorded decisions w/ timestamps). Needs the trigger job to have fired + ≥1 approved action. |
| 3a | `view_query.sql` | ⬜ TODO (regenerate) | The ranked-view query: `gold_open_underperformers ⋈ gold_action_recommendations ORDER BY recoverable_spend_usd DESC` (+ Lakebase `app.*` mirror form) |
| 3b | `view_result.json` | ⬜ TODO (regenerate) | Live rows from the ranked view (hero CMP-0000214 at/near top). Query Lakebase `app.open_underperformers`/`app.action_recommendations`. |
| 4 | `assist_log.jsonl` | ⬜ TODO | Capture ≥1 **explanation** + ≥1 **what-if** Assist interaction (request + model response). Needs working Assist (verify §A). |
| 5 | `drafted_sample.md` | ⬜ TODO | The auto-drafted memo/brief from an Assist run. |
| 6 | `hero_question.txt` | ✅ DONE | Present; hero record **CMP-0000214**. Finalize linked record IDs to match the other exports' decision chain. |
| 7 | `git_history.txt` | ⬜ TODO (regenerate) | `git log --graph --oneline --decorate --all` on `build/brightwave-app` off `main` (shows layer-by-layer build) |

Then: `cd .. && zip -r submission2.zip submission2/` and upload.

> `BUILD2_DELIVERABLES.md` (repo root) is the detailed living tracker — it has the
> full per-artifact spec, layer status, and decision log. **Read it** for depth.

### D. (Optional / talk-track) Build-3 AI Gateway story
Spend cap + guardrails + per-campaign attribution — already fronting
`brightwave-gpt-5-5`. Not a submission2 artifact but part of the demo narrative.

---

## 6. Challenge requirements recap (the grading rubric)

**Technical requirements:** deploy on Databricks Apps reading Build-1 synced UC
table; **never write the synced UC table** (writes go to writable Postgres
`app.campaign_actions_app` / `app.workflow_state`); build on the dev branch, keep
`main` clean; answer the hero question as a **decision** (surface→prescribe→approve→act),
not a lookup/dashboard.

**3 steps:** (1) **Visualize** — live ranked/flagged view + a **defined trigger**
(schedule/system update, scores higher than a person opening it); (2) **Assist** —
explain *why* + scenario/what-if explorer + auto-draft memo, retrieving from
**Lakebase** (not a separate vector store); (3) **Act** — write ≥1 action to the
writable Postgres table with human approve/correct before commit, reflected on
next read (closed loop).

**Hero question (working):** *"Which campaigns are winning and why, and how do I
replicate that across the ones that aren't?"* — hero record **CMP-0000214**.

---

## 7. Orchestration notes (if you continue multi-agent)
- Session constraint: **do NOT use `codex`**. Available implementers this session
  were `claude_code` + `cursor`; reviews cross-vendored between them.
- polly rule: never merge — the human merges each PR. All code changes go to a
  sub-agent; docs/prose (like this file) authored directly.

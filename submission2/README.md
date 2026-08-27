# submission2 — Brightwave Build 2 (Databricks Apps) evidence

The validator scores Build 2 against **this folder only**. Zip `submission2/`
and upload. Contents (8 files; item 3 on the card = two files):

| File | Step | Source | Status |
|---|---|---|---|
| `writeback_table.json` | Act | export of writable Postgres `app.campaign_actions_app` (proposed action, approval status + approver, created + committed timestamps) | ⬜ needs live app |
| `state_table.json` | Visualize+Act | export of Lakebase workflow-state / observability table (trigger events + recorded decisions w/ timestamps) | ⬜ needs live app + trigger |
| `view_query.sql` | Visualize | the query backing the ranked live view | ⬜ from app/config or live |
| `view_result.json` | Visualize | its returned rows | ⬜ needs live data |
| `assist_log.jsonl` | Assist | assistant interactions (request + model response): ≥1 explanation + ≥1 what-if | ⬜ needs live app |
| `drafted_sample.md` | Assist | a sample auto-drafted memo/brief | ⬜ needs live app |
| `hero_question.txt` | cross-cut | hero question + linked record IDs (the decision chain) | ✅ drafted (IDs finalized from live run) |
| `git_history.txt` | cross-cut | `git log --graph --oneline --decorate --all` showing layer-by-layer build on the dev branch off main | ⬜ generate at end |

Notes:
- Deployed on **Databricks Apps** via DABs; app reads Build-1 **synced UC tables**
  in Lakebase; writes ONLY to `app.campaign_actions_app` (synced mirrors read-only).
- Built on git branch `build/brightwave-app` off clean `main`; Lakebase
  **development** branch.
- Assist retrieves creatives from **Lakebase** (Postgres search over
  `app.creatives`), not a separate vector store; agent model routed through the
  **Unity AI Gateway** endpoint `serverless_sandbox_kgi5wi_catalog.brightwave.brightwave-gpt-5-5`.

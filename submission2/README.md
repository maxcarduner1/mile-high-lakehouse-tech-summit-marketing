# submission2 — Brightwave Build 2 (Databricks Apps) evidence

The validator scores Build 2 against **this folder only**. Zip `submission2/`
and upload. Contents (8 files; item 3 on the card = two files):

Hero decision chain: underperformer **CMP-0000790** → replicate matching winner
**CMP-0000469** (ML action `replicate_winner`, +2.304 ROAS lift, $450,919.61 net;
approved action `b1de8a8e-cac0-469c-910a-4942fcf68e8b`).

| File | Step | Source | Status |
|---|---|---|---|
| `writeback_table.json` | Act | export of writable Postgres `app.campaign_actions_app` (proposed action, approval status + approver, created + committed timestamps) | ✅ 1 approved action (790→469) |
| `state_table.json` | Visualize+Act | export of Lakebase workflow-state / observability table (trigger events + recorded decisions w/ timestamps) | ✅ 5 trigger + 1 decision |
| `view_query.sql` | Visualize | the query backing the ranked live view | ✅ app ranked-queue query |
| `view_result.json` | Visualize | its returned rows | ✅ 30 live rows, hero rank #3 |
| `assist_log.jsonl` | Assist | assistant interactions (request + model response): ≥1 explanation + ≥1 what-if | ✅ 3: explanation + what-if + draft |
| `drafted_sample.md` | Assist | a sample auto-drafted memo/brief | ✅ live agent-drafted memo |
| `hero_question.txt` | cross-cut | hero question + linked record IDs (the decision chain) | ✅ 790→469 chain |
| `git_history.txt` | cross-cut | `git log --graph --oneline --decorate --all` showing layer-by-layer build on the dev branch off main | ✅ generated |

Notes:
- Deployed on **Databricks Apps** via DABs; app reads Build-1 **synced UC tables**
  in Lakebase; writes ONLY to `app.campaign_actions_app` (synced mirrors read-only).
- Built on git branch `build/brightwave-app` off clean `main`; Lakebase
  **development** branch.
- Assist retrieves creatives from **Lakebase** (Postgres search over
  `app.creatives`), not a separate vector store; agent model routed through the
  **Unity AI Gateway** endpoint `serverless_sandbox_kgi5wi_catalog.brightwave.brightwave-gpt-5-5`.

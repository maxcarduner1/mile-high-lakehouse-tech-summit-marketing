# Databricks notebook source
# /// script
# [tool.databricks.environment]
# environment_version = "5"
# ///
# MAGIC %md
# MAGIC # Brightwave — Scheduled Refresh · the DEFINED TRIGGER
# MAGIC
# MAGIC This is the Build-2 Layer-1 **defined trigger**: a serverless job on a quartz
# MAGIC cron (every 15 min) that periodically fires on its own — a *system update*,
# MAGIC not a person opening the Campaign Desk. Each run:
# MAGIC
# MAGIC 1. Reads the current row counts of the Brightwave Gold serving tables
# MAGIC    (`gold_campaign_position`, `gold_open_underperformers`) via Spark — the
# MAGIC    "refresh the ranked view's source" heartbeat.
# MAGIC 2. Connects to Lakebase Postgres (`databricks_postgres`) and **INSERTs a
# MAGIC    `trigger` row** into `app.workflow_state` with a timestamp + those row
# MAGIC    counts in `detail`.
# MAGIC
# MAGIC So the workflow-state / observability table accumulates timestamped
# MAGIC **trigger events** (from this job) next to the **decision events** the app
# MAGIC writes when a user commits a campaign action — which is exactly what the
# MAGIC evidence artifact `state_table.json` captures.
# MAGIC
# MAGIC **Lakebase connection choice:** we connect DIRECTLY to Lakebase from the job
# MAGIC (generate-database-credential OAuth token + a pure-Python Postgres driver)
# MAGIC rather than calling the app's `/api/admin/reset` endpoint. That endpoint does
# MAGIC a destructive wipe+resync (it TRUNCATEs the decision rows we want to preserve)
# MAGIC and depends on the app being up — wrong for a lightweight periodic trigger. A
# MAGIC direct append-only INSERT is cleaner and independent of the app's lifecycle.
# MAGIC
# MAGIC **Driver choice — `pg8000` (pure Python), NOT `psycopg2-binary`.** On the
# MAGIC serverless Python kernel, any wheel that bundles a native libpq
# MAGIC (`psycopg2-binary` *and* `psycopg[binary]`) SIGABRTs (exit 134) at **import
# MAGIC time** in `psycopg*/pq` — the bundled libpq's OpenSSL clashes with the OpenSSL
# MAGIC already loaded by the Spark/py4j process, aborting the kernel before we ever
# MAGIC open a connection. `pg8000` speaks the Postgres wire protocol in pure Python
# MAGIC (no libpq, no native OpenSSL), so it loads and connects cleanly on serverless.

# COMMAND ----------

from __future__ import annotations

import json
import os
from datetime import datetime, timezone

# ── Config (widgets in-job so the notebook also runs interactively) ──────────
IN_NOTEBOOK = "dbutils" in dir()
if IN_NOTEBOOK:
    dbutils.widgets.text("catalog", "", "Catalog")
    dbutils.widgets.text("schema", "", "Schema")
    dbutils.widgets.text("lakebase_endpoint", "", "Lakebase endpoint resource path")
    dbutils.widgets.text("pg_database", "databricks_postgres", "Lakebase Postgres database")
    CATALOG = dbutils.widgets.get("catalog")
    SCHEMA = dbutils.widgets.get("schema")
    LAKEBASE_ENDPOINT = dbutils.widgets.get("lakebase_endpoint")
    PG_DATABASE = dbutils.widgets.get("pg_database") or "databricks_postgres"
else:
    import argparse

    _p = argparse.ArgumentParser()
    _p.add_argument("--catalog", default=os.environ.get("DEMO_CATALOG"))
    _p.add_argument("--schema", default=os.environ.get("DEMO_SCHEMA"))
    _p.add_argument("--lakebase_endpoint", default=os.environ.get("LAKEBASE_ENDPOINT"))
    _p.add_argument("--pg_database", default=os.environ.get("PGDATABASE", "databricks_postgres"))
    _a, _ = _p.parse_known_args()
    CATALOG, SCHEMA = _a.catalog, _a.schema
    LAKEBASE_ENDPOINT, PG_DATABASE = _a.lakebase_endpoint, _a.pg_database

assert CATALOG and SCHEMA, "catalog + schema required"
assert LAKEBASE_ENDPOINT and LAKEBASE_ENDPOINT.startswith("projects/"), (
    "lakebase_endpoint must be a resource path like "
    "projects/<proj>/branches/<branch>/endpoints/<endpoint>"
)

print(f"[refresh] catalog={CATALOG} schema={SCHEMA}")
print(f"[refresh] lakebase_endpoint={LAKEBASE_ENDPOINT} db={PG_DATABASE}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Refresh the ranked view's source — read current Gold row counts
# MAGIC
# MAGIC The Campaign Desk ranks `gold_campaign_position` (and its underperformer
# MAGIC subset). Touching those tables here is the "system update" the trigger
# MAGIC represents; the counts get stamped into the trigger row so the
# MAGIC observability log shows what state the desk was in at each firing.

# COMMAND ----------

from pyspark.sql import functions as F  # noqa: E402


def _safe_count(fq_table: str) -> int | None:
    """Row count for a Gold table, or None if the trainee hasn't built it yet."""
    try:
        return spark.table(fq_table).count()
    except Exception as e:  # noqa: BLE001 — table may not exist yet in the workshop
        print(f"[refresh] {fq_table} not available yet: {e}")
        return None


position_fq = f"`{CATALOG}`.`{SCHEMA}`.gold_campaign_position"
under_fq = f"`{CATALOG}`.`{SCHEMA}`.gold_open_underperformers"

position_count = _safe_count(position_fq)
under_count = _safe_count(under_fq)

if position_count is not None:
    bands = (
        spark.table(position_fq)
        .groupBy("perf_band")
        .count()
        .orderBy(F.desc("count"))
    )
    # display() is a notebook helper; in a (non-interactive) job it can misbehave.
    # Guard it: render interactively, just print the rows when running as a job.
    if IN_NOTEBOOK:
        display(bands)
    else:
        print(f"[refresh] perf_band counts: {[r.asDict() for r in bands.collect()]}")

row_counts = {
    "gold_campaign_position": position_count,
    "gold_open_underperformers": under_count,
}
print(f"[refresh] row counts: {row_counts}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Write the TRIGGER row into `app.workflow_state`
# MAGIC
# MAGIC Mint a short-lived Lakebase OAuth credential for the endpoint, resolve the
# MAGIC endpoint host, then `INSERT` one append-only `trigger` row. The table is
# MAGIC created + owned by the app service principal (via Drizzle migrations at app
# MAGIC boot). If this job runs as a different principal you may need a one-time
# MAGIC grant — see the note at the bottom.

# COMMAND ----------

import ssl  # noqa: E402

import pg8000.dbapi  # noqa: E402 — pure-Python PG driver (no native libpq; see header)
from databricks.sdk import WorkspaceClient  # noqa: E402

w = WorkspaceClient()

# Resolve the endpoint host: GET /api/2.0/postgres/<branch>/endpoints
branch_path = LAKEBASE_ENDPOINT.rsplit("/endpoints/", 1)[0]
endpoints = w.api_client.do("GET", f"/api/2.0/postgres/{branch_path}/endpoints")
eps = endpoints.get("endpoints", endpoints) if isinstance(endpoints, dict) else endpoints
if isinstance(eps, dict):
    eps = eps.get("endpoints", [])
host = None
target_ep = LAKEBASE_ENDPOINT.rsplit("/", 1)[-1]
for ep in eps:
    if ep.get("name", "").endswith(f"/endpoints/{target_ep}") or ep.get("name") == LAKEBASE_ENDPOINT:
        host = ep.get("status", {}).get("hosts", {}).get("host")
        break
if host is None and eps:
    host = eps[0].get("status", {}).get("hosts", {}).get("host")
assert host, f"could not resolve Lakebase host for {LAKEBASE_ENDPOINT}"

# Mint an OAuth DB credential: POST /api/2.0/postgres/credentials
cred = w.api_client.do(
    "POST", "/api/2.0/postgres/credentials", body={"endpoint": LAKEBASE_ENDPOINT}
)
token = cred["token"]
user = w.current_user.me().user_name

print(f"[refresh] connecting to {host} as {user} (db={PG_DATABASE})")

detail = {
    "at": datetime.now(timezone.utc).isoformat(),
    "source": "brightwave_refresh",
    "rowCounts": row_counts,
}

# Lakebase requires TLS ("require" semantics: encrypt, don't verify the cert —
# the endpoint uses a Databricks-managed cert, no client CA bundle on the kernel).
ssl_context = ssl.create_default_context()
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE

conn = pg8000.dbapi.connect(
    host=host,
    port=5432,
    database=PG_DATABASE,
    user=user,
    password=token,
    ssl_context=ssl_context,
)
try:
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO app.workflow_state
            (event_type, trigger_source, campaign_id, status, detail)
        VALUES (%s, %s, %s, %s, CAST(%s AS jsonb))
        RETURNING id, created_at
        """,
        ("trigger", "schedule", None, "ok", json.dumps(detail)),
    )
    new_id, created_at = cur.fetchone()
    conn.commit()
    print(f"[refresh] wrote trigger row id={new_id} at {created_at}")
finally:
    conn.close()

# COMMAND ----------

# MAGIC %md
# MAGIC ### One-time grant (if the job principal ≠ the app service principal)
# MAGIC
# MAGIC `app.workflow_state` is created and owned by the app SP (Drizzle migrations
# MAGIC run as the SP at app boot). If this scheduled job runs as a *different*
# MAGIC identity, grant it insert rights once from a session owned by the app SP:
# MAGIC
# MAGIC ```sql
# MAGIC GRANT USAGE ON SCHEMA app TO "<job-principal>";
# MAGIC GRANT INSERT ON app.workflow_state TO "<job-principal>";
# MAGIC ```
# MAGIC
# MAGIC In this demo the simplest path is to run the job as the same service
# MAGIC principal that runs the app (set `run_as` on the job to the app SP), so no
# MAGIC extra grant is needed.

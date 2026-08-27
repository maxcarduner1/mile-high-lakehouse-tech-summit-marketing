import type { Request } from 'express';
import { getExecutionContext } from '@databricks/appkit';

/**
 * Build the Authorization header for an outbound Databricks call.
 *
 * - Prod: Databricks Apps injects `x-forwarded-access-token` for OBO — use it
 *   so the call is attributed to the viewing user (MLflow traces, audit logs,
 *   UC permissions).
 * - Dev / no forwarded token: delegate to the SDK's auth chain via the
 *   current WorkspaceClient. This picks up the CLI profile, handles OAuth
 *   refresh automatically (no more 1-hour token expiry), works with service
 *   principal creds, Azure CLI, etc. — whatever the user's local config is.
 *
 * ── Keep this DUMB — no service-principal / oauth-m2m special-casing here ────
 * When this app runs against a REMOTE TARGET workspace (cross-workspace deploy),
 * the launcher authenticates it as the deployer service principal purely via
 * ENV: it sets DATABRICKS_AUTH_TYPE=oauth-m2m + DATABRICKS_CLIENT_ID/SECRET +
 * DATABRICKS_HOST for the target and REMOVES DATABRICKS_TOKEN from the child's
 * env. So the SDK's default credential chain (below) resolves oauth-m2m on its
 * own — every path in this app (this helper, execSql, mlflow, warehouse, the
 * Lakebase pool) authenticates correctly with ZERO app-side auth logic. Do NOT
 * re-introduce a pinned WorkspaceClient here: the env is the single source of
 * truth (see the generator's core/auth.py). An earlier fix pinned oauth-m2m in
 * this file to work around a PRESENT-but-empty DATABRICKS_TOKEN; that empty
 * token is no longer injected, so the workaround is unnecessary and would only
 * risk drift between this file and its ~10 shipped copies.
 *
 * Callers do `const headers = await authHeaders(req); h.set('Content-Type', ...)`
 * and pass `headers` straight to `fetch()`.
 */
export async function authHeaders(req: Request): Promise<Headers> {
  const h = new Headers();
  const userToken = req.headers['x-forwarded-access-token'] as string | undefined;
  if (userToken) {
    h.set('Authorization', `Bearer ${userToken}`);
    return h;
  }
  return serviceAuthHeaders();
}

/**
 * Build the Authorization header authenticated as the APP SERVICE PRINCIPAL,
 * ALWAYS — never the viewing user. This is the `else` branch of `authHeaders`
 * hoisted so a caller can opt into the SP token even when a user OBO token is
 * present on the request.
 *
 * Why the agent's gateway client needs this (DEMO): the Assist agent calls the
 * Unity AI Gateway Responses route (`/ai-gateway/mlflow/v1/responses`), which
 * requires the `ai-gateway` scope. The user's minted OBO token
 * (`x-forwarded-access-token`) does NOT carry that scope, so authenticating the
 * gateway call as the user returns `403 Invalid scope, required scopes:
 * ai-gateway`. The app service principal IS authorized for the gateway, and we
 * don't need per-user attribution on the agent's model call for this demo — so
 * the gateway client authenticates as the SP instead. Other callers
 * (ask_data/Genie, warehouse SQL, MLflow) keep using `authHeaders(req)` and
 * stay OBO-attributed.
 *
 * Mechanism: `getExecutionContext()` returns the singleton `ServiceContext`'s
 * WorkspaceClient here — this app never wraps request handlers in
 * `Plugin.asUser` / `runInUserContext`, so the execution context is the SP
 * context, not a user context. In the Apps container the SDK default credential
 * chain resolves that client to oauth-m2m via env (DATABRICKS_HOST +
 * DATABRICKS_CLIENT_ID/SECRET), which is exactly the app SP bearer we want.
 * `config.authenticate(h)` also handles token refresh, so no 1-hour expiry.
 */
export async function serviceAuthHeaders(): Promise<Headers> {
  const h = new Headers();
  const { client } = getExecutionContext();
  await client.config.authenticate(h);
  return h;
}

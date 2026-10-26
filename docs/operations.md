# MDM operations runbook

Day-2 tasks for an installed MDM: what to watch, what to change, and what to do when something
breaks. Object names below are the installer defaults; substitute yours if you changed them.

| Default name | What it is |
|---|---|
| `MDM_PG` | Snowflake Postgres instance — the system of record (all edits happen here) |
| `MDM_MIRROR` | CDC mirror database (`MDM_MIRROR.MDM.*`), one row per record version, read-only |
| `MDM` | Snowflake database: `MDM_ANALYTICS` (current-state views, history, semantic view), `GOVERNANCE` (policies, tags), `PUBLISH` (golden records for consumers), `MDM_AI` (alert log) |
| `MDM_WH` | Warehouse for Analyst, dynamic tables and DMFs |
| `MDM_SVC` / `MDM_SERVICE_ROLE` | Service user the API connects as |

---

## 1. Daily: is everything healthy?

| Where | What to look for |
|---|---|
| App notification bell (admins) | `Snowflake: …` entries are open findings from the mirror health check. They close on their own when the condition clears. |
| Configuration › Integrations › Replication | Mirror status, last apply time, dynamic table lag. |
| Configuration › System › Health | API, Postgres and Snowflake connectivity. |
| Snowsight › Data Quality (or the query below) | Hourly `FRESHNESS` and `ROW_COUNT` on `V_CURRENT_CUSTOMER / PRODUCT / SUPPLIER`. |

```sql
-- Open operational findings
SELECT alert_name, severity, message, raised_at, last_seen_at
FROM MDM.MDM_AI.ALERT_LOG WHERE resolved_at IS NULL ORDER BY raised_at DESC;

-- Mirror health check runs (serverless task, every 15 minutes)
SELECT state, error_message, scheduled_time
FROM TABLE(MDM.INFORMATION_SCHEMA.TASK_HISTORY(TASK_NAME => 'TASK_CHECK_MIRROR_HEALTH'))
ORDER BY scheduled_time DESC LIMIT 10;

-- Snowflake-side freshness / volume (seconds since newest change; record count)
SELECT table_name, metric_name, value, measurement_time
FROM SNOWFLAKE.LOCAL.DATA_QUALITY_MONITORING_RESULTS
WHERE table_database = 'MDM' AND metric_name IN ('FRESHNESS', 'ROW_COUNT')
QUALIFY ROW_NUMBER() OVER (PARTITION BY table_name, metric_name ORDER BY measurement_time DESC) = 1;
```

Record-level data quality (rules, scores, failures) is in the app's Data Quality page — it is
computed in Postgres, not in Snowflake.

## 2. Cost

- **Warehouse:** `MDM_WH`, XSMALL, auto-suspend 60 s, initially suspended.
- **Resource monitor:** `MDM_WH_RM`, monthly quota `CREDIT_QUOTA` (installer default 50): notify
  at 80 %, suspend at 100 % (running queries finish), suspend immediately at 110 %.
  When suspended, Cortex Analyst / the agent and dynamic table refreshes stop until the next month
  or until you raise the quota. The app itself keeps working (it runs on Postgres).

| Consumer | Runs on | Frequency |
|---|---|---|
| Cortex Analyst / agent queries | `MDM_WH` | on demand |
| Dynamic tables `<TABLE>_HISTORY` (one per module) | `MDM_WH` | per target lag, only when the mirror changed |
| Freshness / volume DMFs | serverless (DMF billing) | `DMF_SCHEDULE`, default hourly |
| Mirror health check | serverless task | 15 minutes |
| CDC mirror | Snowflake Postgres replication | `MIRROR_REFRESH`, default 1 minute |

```sql
-- Credits used this month vs quota
SHOW RESOURCE MONITORS LIKE 'MDM_WH_RM';
-- Raise the quota
ALTER RESOURCE MONITOR MDM_WH_RM SET CREDIT_QUOTA = 100;
-- Where credits went (last 30 days; ACCOUNT_USAGE lags up to ~3 h)
SELECT DATE_TRUNC('day', start_time) d, SUM(credits_used) credits
FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY
WHERE warehouse_name = 'MDM_WH' AND start_time > DATEADD('day', -30, CURRENT_TIMESTAMP())
GROUP BY 1 ORDER BY 1;
```

Avoid adding warehouse-based tasks or alerts on a short schedule: each run wakes `MDM_WH` for at
least 60 s. Use serverless tasks for frequent checks.

## 3. Replication (Postgres → Snowflake)

Edits land in Postgres; the CDC mirror copies every change into `MDM_MIRROR.MDM` (one row per
version). `MDM_ANALYTICS.V_CURRENT_*` views keep the latest version; `*_HISTORY` dynamic tables
keep the SCD2 history.

**Deleted records.** The app soft-deletes (`is_deleted`). A hard `DELETE` in Postgres (clean-up,
reloading data) would leave the row's last version in the mirror for good, so a trigger records each
one in `mdm.deleted_record` (migration 022). That table is mirrored too, and the current-state views and
history tables hide any record whose tombstone is newer than its last version. To check Postgres and
Snowflake agree: compare `SELECT COUNT(*) FROM mdm.customer` with
`SELECT COUNT(*) FROM MDM.MDM_ANALYTICS.V_CURRENT_CUSTOMER` (as an unrestricted role).

**Change the mirror refresh interval** — from Configuration › Integrations › Replication, or:

```sql
CALL SNOWFLAKE.POSTGRES.ALTER_MIRROR('mdm_mirror', refresh_interval => '5 minutes');
CALL SNOWFLAKE.POSTGRES.LIST_MIRRORS('MDM_PG');   -- STATUS, LAST_APPLY_TIME, ERROR_MESSAGE
```

The app goes through `MDM.MDM_AI.GET_MIRROR_STATUS()` and `SET_MIRROR_REFRESH(interval)`: owner's-rights
wrappers, because the mirror procedures require the `postgres_mirror_admin` application role and
ownership of the Postgres instance, which the service role must not have.

Longer intervals cost less replication but delay what Analyst, the agent and PUBLISH consumers see.

**Change dynamic table lag** — from the same page, or `ALTER DYNAMIC TABLE MDM.MDM_ANALYTICS.CUSTOMER_HISTORY SET TARGET_LAG = '1 hour';`
Force a refresh: `ALTER DYNAMIC TABLE … REFRESH;`

**When the bell shows "Snowflake: CDC mirror …"**

1. `CALL SNOWFLAKE.POSTGRES.LIST_MIRRORS('MDM_PG');` — read `STATUS` and `ERROR_MESSAGE`.
2. Check the Postgres instance is running: `DESCRIBE POSTGRES INSTANCE MDM_PG;` (a suspended
   instance stops replication; `ALTER POSTGRES INSTANCE MDM_PG RESUME;`).
3. If the error mentions a table, check for a recent schema migration on that table.
4. Once fixed, the next health check (≤ 15 min) closes the finding. Run it immediately with
   `EXECUTE TASK MDM.MDM_AI.TASK_CHECK_MIRROR_HEALTH;`.

Note: `LAST_APPLY_TIME` only moves when there are changes, so an old timestamp on a quiet day is
normal. The health check deliberately does not alert on time alone.

### Module objects (`SYNC_MODULES`)

Every module in the configuration, enabled or not, gets in Snowflake: `V_CURRENT_<TABLE>` (PII
tags, `<MODULE>_SCOPE_RAP` when it has `country_code`, freshness/volume DMFs), the
`<TABLE>_HISTORY` dynamic table, and `PUBLISH.<MODULE>_GOLDEN` / `_XREF`. Enabled modules also get
`V_<TABLE>_360` and are part of `V_MDM_KPIS`, `V_WORKFLOW_QUEUE` and the semantic view
`MDM_ANALYTICS_VIEW`.

The API calls `MDM_ANALYTICS.SYNC_MODULES(<config version>)` a few seconds after any change under
Configuration → Modules. The procedure reads the configuration from the mirror, so it answers
`pending` until the mirror holds that version; the API retries every 30 s for up to 6 minutes.
Objects whose columns and policy are already right are left alone.

- Status: Configuration → Integrations → Replication, "Snowflake module objects" (last run per
  module, from `MDM_AI.MODULE_SYNC_LOG`), or `GET /api/admin/modules/sync`.
- Manual run: the **Resynchronise** button, or `CALL MDM.MDM_ANALYTICS.SYNC_MODULES(0);`.
- `country_null_all: true` on a module makes records without a country visible to every
  country-scoped role (used for products).

## 4. Postgres backup and point-in-time recovery

Snowflake Postgres takes automated backups; you do not schedule them. Recovery is by **fork**: a
new, independent instance that reflects the origin at a chosen time, within the **10-day**
retention window. A fork is a full copy, billed like any instance (size, storage, HA). Credentials
are the same as the origin. Creating a fork requires OWNERSHIP on the origin instance.

```sql
-- State 30 minutes ago
CREATE POSTGRES INSTANCE MDM_PG_RESTORE FORK MDM_PG AT (OFFSET => -30*60);
-- State at a timestamp (UTC unless cast)
CREATE POSTGRES INSTANCE MDM_PG_RESTORE FORK MDM_PG AT (TIMESTAMP => '2026-10-20 08:00:00');
DESCRIBE POSTGRES INSTANCE MDM_PG_RESTORE;   -- wait for state Ready
```

**Recovering a few records** (typical case — an accidental bulk edit or merge):

1. Fork to just before the incident.
2. Connect to the fork with `psql` (same credentials, new host from `DESCRIBE`).
3. Export the affected rows (`\copy (SELECT … FROM mdm.customer WHERE id IN (…)) TO 'rows.csv' CSV HEADER`)
   and re-apply them to `MDM_PG` — preferably through the app/API so audit, DQ and the mirror
   all see the change. For merges, use Unmerge in the app first; it restores the merged records.
4. Drop the fork: `DROP POSTGRES INSTANCE MDM_PG_RESTORE;`

**Recovering the whole database** (corruption, unrecoverable migration):

1. Fork to the last good time.
2. Point the API at the fork: update the Postgres host in the service configuration
   (`.env.local` / SPCS secret), restart the API.
3. Recreate the CDC mirror from the fork (`CALL SNOWFLAKE.POSTGRES.CREATE_MIRROR(…)`, as in
   `setup.sh`) into the existing mirror database, then refresh the dynamic tables. Snowflake-side
   history after the fork point is replaced by the fork's history.
4. Keep the old instance suspended until you are sure, then drop it.

The audit log, workflows, config history and comments live in Postgres too, so they are restored
along with the data. Snowflake objects (policies, tags, PUBLISH views) are not affected by a fork.

## 5. Security tasks

### Users and Snowflake roles
- App users, their business role and their **Snowflake role** are managed in Configuration ›
  Security › Users. The Snowflake role decides row access (country scope) in Analyst, the agent
  and PUBLISH, **and** whether the user sees personal data in clear — in Snowflake and in the app.
- A user without a Snowflake role sees no rows in Analyst and masked personal data everywhere.
- Business roles (Security › Roles) drive workflows and app permissions only.

### Personal data (PII) masking
Configuration › Security › Data masking:
- **Masked columns** per entity → `PII_TYPE` tags on the Snowflake views and masking in API responses.
- **Roles that see PII in clear** → `GOVERNANCE.PII_UNMASK_ROLES`. Role inheritance applies.
  `ACCOUNTADMIN` and `MDM_SERVICE_ROLE` always see clear values.
- The "Result per user" table shows the effect for every user.
- If the page shows **Not synced to Snowflake** (Snowflake was unreachable during a save), click
  **Re-sync**. The app already masks according to the saved config in the meantime.
- Grants changed directly in Snowflake are picked up by the app within 10 minutes.

### Rotate the service user's key (key-pair auth)
Snowflake allows two public keys per user, so rotation has no downtime:

```bash
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out mdm_svc_key_new.p8
openssl rsa -in mdm_svc_key_new.p8 -pubout -out mdm_svc_key_new.pub
```
```sql
ALTER USER MDM_SVC SET RSA_PUBLIC_KEY_2 = '<contents of mdm_svc_key_new.pub without header lines>';
```
Point the API at the new key (`SF_PRIVATE_KEY_PATH` or the SPCS secret), restart, confirm
Configuration › System › Health is green, then remove the old key:
`ALTER USER MDM_SVC UNSET RSA_PUBLIC_KEY;`. Next rotation goes the other way round.
For PAT auth (`SF_PAT`), create a new token, swap it, then revoke the old one.

### Rotate Postgres credentials
Snowflake Postgres › instance › Manage › **Regenerate credentials** returns a new connection
string. Update the API's Postgres settings and restart. Forks share the origin's credentials at
creation time.

## 6. Periodic reviews (monthly)

**New personal data in the model.** After adding fields (Configuration › Modules), run Snowflake
classification and compare with the masked columns:

```sql
CALL SYSTEM$CLASSIFY('MDM.MDM_ANALYTICS.V_CURRENT_CUSTOMER', {'sample_count': 100});
SELECT f.key column_name, f.value:recommendation:semantic_category::STRING semantic,
       f.value:recommendation:privacy_category::STRING privacy
FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())) r, LATERAL FLATTEN(input => r.$1:classification_result) f
WHERE f.value:recommendation IS NOT NULL;
```
Columns reported as `IDENTIFIER` that hold data about people should be ticked in Data masking.
Company-level values (website, trade name) usually need not be.

**No direct access to the raw mirror.** Only the service role should read `MDM_MIRROR`; everyone
else goes through `MDM_ANALYTICS` (row access + masking apply there):
```sql
SHOW GRANTS ON DATABASE MDM_MIRROR;
SHOW FUTURE GRANTS IN DATABASE MDM_MIRROR;
```

**Who can see personal data.** Review Configuration › Security › Data masking › Result per user.

## 7. Things intentionally removed — do not recreate

| Object | Why it is gone |
|---|---|
| `MDM_CUSTOMER_ACCESS_POLICY`, table `MDM_USER_ACCESS` | Replaced by the scope-driven row access policies in `GOVERNANCE` (`004_governance.sql`). |
| Viewer grants on the mirror database | Viewers read `MDM_ANALYTICS` only, so policies cannot be bypassed. |
| `MDM.MDM_MIRROR` schema, `MDM_AI.sp_find_*`, `sp_translate_*`, e-mail alerts | Matching, translation, DQ and workflow follow-up run in Postgres/the app; e-mail alerts were replaced by `ALERT_LOG` + the bell. |

## 8. Script reference

`setup.sh` runs `snowflake/0*.sql` in order; each script is idempotent and can be re-run on its own
(`snow sql -f snowflake/<file> -D database=MDM …`, see each file's header for its variables).

| Script | Creates |
|---|---|
| `001_roles_warehouse.sql` | Database, schemas, `MDM_WH`, resource monitor, MDM roles |
| `002_current_and_history.sql` | `V_CURRENT_*` views of the shared tables (exclude tombstoned deletes) |
| `003_analytics.sql` | DQ scorecard view |
| `004_governance.sql` | Row access policies, PII tag + masking policy, `SET_PII_COLUMNS` |
| `005_publish.sql` | `PUBLISH` schema and consumer grants |
| `006_dq_dmfs.sql` | Grant to read DMF results |
| `007_cortex_ai.sql` | `ALERT_LOG`, mirror health task, `GET_MIRROR_STATUS` / `SET_MIRROR_REFRESH` |
| `008_modules.sql` | `SYNC_MODULES` + `MODULE_SYNC_LOG`: everything per module (views, history, policies, DMFs, PUBLISH, 360, KPIs, semantic view) |
| `deploy/share_publish.sql` | Optional: share `PUBLISH` with other accounts (not run by setup) |

Re-running `002` replaces the views and dynamic tables, which drops their row access policies, PII tags
and DMFs: re-run `004` and `006` right after it.

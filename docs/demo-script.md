# Demo script (about 20 minutes)

Run locally (`bash mdm-api/start-dev.sh`, `cd mdm-ui && npm run dev`) and switch users from the avatar menu
(dev auth). Reset the sample data beforehand with `node reset_demo.cjs` if a previous demo changed it.

| User | Role | Sees |
|---|---|---|
| Benoit De Clarens | Admin (`MDM_ADMIN_ROLE`) | Everything, PII in clear |
| Alice Martin | Steward FRA/BEL (`MDM_STEWARD_FRA_BEL`) | French and Belgian records, PII masked |
| Hans Mueller | Steward DEU (`MDM_STEWARD_DEU`) | German records |
| Sarah Jones | Viewer GBR (`MDM_VIEWER_ROLE`) | Read-only |

## 1. The problem (2 min) — as Benoit

- **Dashboard**: records per module, data quality, open workflows, potential duplicates.
- Open the **notification bell**: what needs attention right now (failing rules, workflows assigned to me,
  recent merges, platform alerts).

## 2. Find and fix duplicates (5 min)

- **Match & Merge** › Customers: **Scan for matches**. Fuzzy and phonetic stages run in Postgres;
  composite rules, Cortex embeddings and an LLM judge refine the score. Each pair shows the method and score.
- Open a pair, pick the survivor, override a field from the other record, **Merge**.
- **Golden records**: the merged record keeps one golden ID with both source cross-references.
- **Merge history** › **Unmerge**: everything is reversible, including moved children and workflows.

## 3. Data quality (4 min)

- **Data Quality**: rules by severity with pass rates and trends; open a failing rule to see the records.
- **Configuration › Customers › Data Quality**: rules come from templates applied per field
  (format, completeness, reference lists, checksums). Toggle one, apply, run.
- On a customer: the DQ tab lists the failing rules; **AI remediate** (record footer) has Cortex propose
  corrections, highlighted in edit mode for review before saving.

## 4. Governance and workflows (4 min)

- Create a customer: an **onboarding workflow** opens automatically (Draft → Review → Validated → Active).
- Change a customer's parent in its hierarchy tab: the change waits for approval in a
  **hierarchy-change workflow** instead of being applied.
- **Workflows**: approve as the assigned role; the record's lifecycle stage follows.
- **Audit trail**: every change, who made it, before and after.

## 5. One access model, app and Snowflake (3 min)

- Switch to **Alice**: only French and Belgian customers; email, phone and tax ID are masked and read-only.
- **Cortex Analyst**: "How many active customers per country?" — same rows, same masking, because Snowflake
  enforces the same scope on Alice's Snowflake role.
- Back as Benoit: **Configuration › Security › Data masking** — pick the masked columns and the roles that
  see PII in clear; both the app and Snowflake follow.

## 6. Snowflake platform (2 min)

- **Configuration › Integrations › Replication**: the CDC mirror (Postgres → Snowflake, 1 minute) and the
  history dynamic tables.
- In Snowsight: `MDM.PUBLISH.CUSTOMER_GOLDEN` for downstream consumers (shareable), `MDM_ANALYTICS.CUSTOMER_HISTORY`
  for point-in-time questions, data metric functions for freshness and volume.
- **Configuration › System › Health**: Postgres, Snowflake and mirror status.

## Questions to expect

- *Where is the data?* Postgres in Snowflake is the system of record; Snowflake holds the mirrored copy for
  analytics, AI and sharing. Nothing leaves the Snowflake account.
- *Can we add an entity?* A module is a configuration block plus a migration; the screens, API and Snowflake
  policies follow (see `docs/architecture.md`).
- *Cost?* One warehouse with a resource monitor; health checks and DMFs are serverless and infrequent
  (see `docs/operations.md`).

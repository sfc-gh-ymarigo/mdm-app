-- ============================================================
-- 008 — Per-module Snowflake objects, generated from the module configuration
-- ============================================================
-- Templated:  snow sql -f snowflake/008_modules.sql -D database=MDM -D mirror_database=MDM_MIRROR
--             -D warehouse=MDM_WH -D dmf_schedule='60 MINUTE'
--
-- MDM_ANALYTICS.SYNC_MODULES(min_version) reads the latest configuration from the mirror
-- (<mirror>.MDM.APP_CONFIG) and builds, for every module of the configuration:
--   MDM_ANALYTICS.V_CURRENT_<T>     latest version per id, tombstoned deletes removed, row access
--                                   policy and PII tags attached at creation (no unprotected window)
--   MDM_ANALYTICS.<T>_HISTORY       SCD2 dynamic table over <T>$CHANGES
--   GOVERNANCE.<M>_SCOPE_RAP        country scope for the module (V_ROLE_SCOPE / V_MODULE_SCOPE)
--   PUBLISH.<M>_GOLDEN / <M>_XREF   golden records and cross-reference for consumers
--   freshness / volume DMFs on the current view
-- and, for the enabled modules only:
--   MDM_ANALYTICS.V_<T>_360, V_MDM_KPIS, V_WORKFLOW_QUEUE, GOVERNANCE.V_ENTITY_COUNTRY
--   MDM_ANALYTICS.MDM_ANALYTICS_VIEW  semantic view for Cortex Analyst
-- (<T> = table name, <M> = module id; both upper case.)
--
-- Called by setup (below) and by the app when a module is enabled, disabled or its fields change.
-- min_version: the config version the app has just saved; if the mirror has not caught up yet the
-- procedure returns status "pending" and the app retries.
-- Owner's rights: it runs DDL as its owner, so nothing from the configuration is trusted: every
-- identifier is checked against a strict pattern and only columns that exist in the mirror are used.
-- Results: MDM_AI.MODULE_SYNC_LOG (Configuration › Health).
-- ============================================================

USE ROLE ACCOUNTADMIN;

CREATE TABLE IF NOT EXISTS <% database %>.MDM_AI.MODULE_SYNC_LOG (
  synced_at      TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
  config_version NUMBER,
  module         STRING,      -- module id, or SEMANTIC_VIEW / SHARED
  status         STRING,      -- OK | ERROR | SKIPPED
  detail         STRING
) COMMENT = 'Results of MDM_ANALYTICS.SYNC_MODULES (one row per module per run)';
GRANT SELECT ON TABLE <% database %>.MDM_AI.MODULE_SYNC_LOG TO ROLE MDM_SERVICE_ROLE;

-- The API reads module tables in the mirror (row counts on the Health page). The mirror
-- creates a table per Postgres table, so new modules are covered by the future grant.
GRANT SELECT ON ALL TABLES IN SCHEMA <% mirror_database %>.MDM TO ROLE MDM_SERVICE_ROLE;
GRANT SELECT ON FUTURE TABLES IN SCHEMA <% mirror_database %>.MDM TO ROLE MDM_SERVICE_ROLE;

CREATE OR REPLACE PROCEDURE <% database %>.MDM_ANALYTICS.SYNC_MODULES(MIN_VERSION NUMBER)
RETURNS STRING
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'run'
COMMENT = 'Builds the per-module Snowflake objects from the mirrored MDM configuration (see snowflake/008_modules.sql)'
EXECUTE AS OWNER
AS
$$
import json
import re

DB = '<% database %>'
MIRROR = '<% mirror_database %>'
WH = '<% warehouse %>'
DMF_SCHEDULE = '<% dmf_schedule %>'
A = DB + '.MDM_ANALYTICS'
G = DB + '.GOVERNANCE'
P = DB + '.PUBLISH'

IDENT = re.compile(r'^[a-z_][a-z0-9_]{0,62}$')
CODE = re.compile(r'^[A-Za-z0-9_+\-]{1,60}$')
# Same defaults as mdm-api/src/pii.ts
DEFAULT_PII = {
    'customer': ['tax_id', 'email', 'phone'],
    'supplier': ['tax_id', 'vat_number', 'bank_account_iban', 'email', 'primary_contact_email', 'phone'],
}
UNPUBLISHED_GROUPS = {'financial', 'financials', 'commercial', 'contract'}
NOT_PUBLISHED = {'id', 'golden_id', 'source_system', 'source_id', 'is_deleted'}


def ident(value, what):
    if not isinstance(value, str) or not IDENT.match(value):
        raise ValueError('invalid %s: %r' % (what, value))
    return value


def lit(s):
    return "'" + str(s).replace('\\', '\\\\').replace("'", "''") + "'"


def pii_tag(col):
    c = col.upper()
    return 'EMAIL' if 'EMAIL' in c else 'PHONE' if 'PHONE' in c else 'TAX_ID'


class Sync:
    def __init__(self, session, version):
        self.s = session
        self.version = version
        self.log_rows = []

    # ── helpers ──
    def sql(self, q):
        return self.s.sql(q).collect()

    def try_sql(self, q, ignore=('already',)):
        try:
            self.sql(q)
        except Exception as e:
            if not any(i in str(e).lower() for i in ignore):
                raise

    def log(self, module, status, detail=''):
        self.log_rows.append((module, status, str(detail)[:4000]))

    def columns(self, database, schema, table):
        rows = self.sql(
            "SELECT column_name, data_type FROM %s.INFORMATION_SCHEMA.COLUMNS "
            "WHERE table_schema = %s AND table_name = %s ORDER BY ordinal_position"
            % (database, lit(schema), lit(table)))
        return [(r[0], r[1]) for r in rows]

    def row_policy(self, obj, domain):
        try:
            rows = self.sql(
                "SELECT policy_name FROM TABLE(%s.INFORMATION_SCHEMA.POLICY_REFERENCES("
                "REF_ENTITY_NAME => %s, REF_ENTITY_DOMAIN => %s)) WHERE policy_kind = 'ROW_ACCESS_POLICY'"
                % (DB, lit(obj), lit(domain)))
            return rows[0][0] if rows else None
        except Exception:
            return None

    def codes(self, domain):
        rows = self.sql(
            "SELECT DISTINCT code FROM %s.V_CURRENT_REF_CODELIST WHERE domain = %s AND is_active "
            "ORDER BY code LIMIT 40" % (A, lit(domain)))
        return [r[0] for r in rows if r[0] and CODE.match(str(r[0]))]

    def stages(self, entity):
        rows = self.sql(
            "SELECT stage_code FROM %s.MDM.REF_LIFECYCLE_STAGE WHERE entity_type = %s "
            "QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY id) = 1 ORDER BY sort_order"
            % (MIRROR, lit(entity)))
        out = []
        for r in rows:
            if r[0] and CODE.match(r[0]) and r[0] not in out:
                out.append(r[0])
        return out

    def live_stage(self, entity):
        """Stage a record reaches at the end of onboarding (ACTIVE, PUBLISHED …)."""
        rows = self.sql(
            "SELECT t.entity_stage FROM %s.MDM.REF_LIFECYCLE_TRANSITION t "
            "JOIN %s.MDM.REF_LIFECYCLE_STAGE s ON s.entity_type = t.entity_type AND s.stage_code = t.entity_stage "
            "WHERE t.entity_type = %s AND t.workflow_type = 'ONBOARDING' ORDER BY s.sort_order DESC LIMIT 1"
            % (MIRROR, MIRROR, lit(entity)))
        stage = rows[0][0] if rows else 'ACTIVE'
        return stage if CODE.match(stage or '') else 'ACTIVE'

    # ── per module ──
    def module_info(self, m, cfg):
        mid = ident(m.get('id'), 'module id')
        schema, _, table = str(m.get('table', '')).partition('.')
        if schema != 'mdm':
            raise ValueError('module table must be in schema mdm: %r' % m.get('table'))
        table = ident(table, 'table')
        T = table.upper()
        cols = self.columns(MIRROR, 'MDM', T)
        if not cols:
            return None
        colset = {c for c, _ in cols}
        text_cols = {c for c, t in cols if t == 'TEXT'}
        fields = []
        for f in m.get('fields', []):
            name = f.get('name')
            if f.get('active') is False or not isinstance(name, str) or not IDENT.match(name):
                continue
            if name.upper() in colset:
                fields.append(f)
        gov = cfg.get('governance') or {}
        pii_cfg = gov.get('pii_fields') or DEFAULT_PII
        pii = sorted({c.upper() for c in pii_cfg.get(mid, []) if isinstance(c, str) and IDENT.match(c)} & text_cols)
        name_field = m.get('name_field') if isinstance(m.get('name_field'), str) and IDENT.match(m.get('name_field')) else None
        if name_field and name_field.upper() not in colset:
            name_field = None
        ts = 'UPDATED_AT' if 'UPDATED_AT' in colset else 'CREATED_AT'
        return dict(m=m, id=mid, M=mid.upper(), table=table, T=T, cols=cols, colset=colset, fields=fields,
                    pii=pii, name_field=name_field, ts=ts, enabled=bool(m.get('enabled')),
                    country='COUNTRY_CODE' in colset)

    def ensure_policy(self, x):
        if not x['country']:
            return None
        pol = '%s.%s_SCOPE_RAP' % (G, x['M'])
        null_all = 'OR country_code IS NULL ' if x['m'].get('country_null_all') else ''
        self.sql("CREATE ROW ACCESS POLICY IF NOT EXISTS %s AS (country_code VARCHAR) RETURNS BOOLEAN -> FALSE" % pol)
        self.sql(
            "ALTER ROW ACCESS POLICY %s SET BODY -> "
            "CURRENT_ROLE() IN ('ACCOUNTADMIN', 'MDM_SERVICE_ROLE', 'MDM_CONSUMER_ROLE') "
            "OR EXISTS (SELECT 1 FROM %s.V_ROLE_SCOPE s JOIN %s.V_MODULE_SCOPE m ON m.module_id = %s "
            "WHERE s.sf_role = CURRENT_ROLE() AND (s.country_code = '*' OR NOT m.country_scoped %s"
            "OR s.country_code = country_code))"
            % (pol, G, G, lit(x['M']), null_all))
        return pol

    def current_view(self, x, pol):
        view = '%s.V_CURRENT_%s' % (A, x['T'])
        want = [c for c, _ in x['cols']]
        have = [c for c, _ in self.columns(DB, 'MDM_ANALYTICS', 'V_CURRENT_' + x['T'])]
        current_pol = self.row_policy(view, 'VIEW')
        want_pol = pol.split('.')[-1] if pol else None
        if have == want and (current_pol or None) == want_pol:
            return view, False
        collist = ', '.join(
            '%s WITH TAG (%s.PII_TYPE = %s)' % (c, G, lit(pii_tag(c))) if c in x['pii'] else c for c in want)
        rap = (' WITH ROW ACCESS POLICY %s ON (COUNTRY_CODE)' % pol) if pol else ''
        self.sql(
            "CREATE OR REPLACE VIEW %s (%s)%s COPY GRANTS COMMENT = %s AS "
            "SELECT * EXCLUDE (rn) FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY %s DESC) AS rn "
            "FROM %s.MDM.%s) v WHERE rn = 1 AND NOT EXISTS (SELECT 1 FROM %s.MDM.DELETED_RECORD d "
            "WHERE d.table_name = %s AND d.record_id = v.id::STRING AND d.deleted_at >= v.%s)"
            % (view, collist, rap, lit('%s: current state (latest version, deletes removed)' % x['m'].get('label', x['id'])),
               x['ts'], MIRROR, x['T'], MIRROR, lit(x['table']), x['ts']))
        return view, True

    def dmfs(self, view, x):
        self.sql("ALTER VIEW %s SET DATA_METRIC_SCHEDULE = %s" % (view, lit(DMF_SCHEDULE)))
        self.try_sql("ALTER VIEW %s ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.ROW_COUNT ON ()" % view)
        if x['ts'] in x['colset']:
            self.try_sql("ALTER VIEW %s ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.FRESHNESS ON (%s)" % (view, x['ts']))

    def history(self, x, pol):
        changes = [c for c, _ in self.columns(MIRROR, 'MDM', x['T'] + '$CHANGES')]
        if not changes:
            return 'no change feed'
        cols = [c for c, _ in x['cols'] if c in changes]
        dt = '%s.%s_HISTORY' % (A, x['T'])
        want = cols + ['VALID_FROM', 'VALID_TO', 'IS_CURRENT', 'VERSION_NUMBER', 'CHANGE_TYPE']
        have = [c for c, _ in self.columns(DB, 'MDM_ANALYTICS', x['T'] + '_HISTORY')]
        want_pol = pol.split('.')[-1] if pol else None
        if have == want and (self.row_policy(dt, 'TABLE') or None) == want_pol:
            return 'unchanged'
        lag = '5 minutes'
        try:
            r = self.sql("SELECT target_lag_sec FROM TABLE(%s.INFORMATION_SCHEMA.DYNAMIC_TABLES(NAME => %s))"
                         % (DB, lit(dt)))
            if r and r[0][0]:
                lag = '%d seconds' % int(r[0][0])
        except Exception:
            pass
        sel = ', '.join(cols)
        out = ', '.join('changes.' + c for c in cols)
        rap = (' WITH ROW ACCESS POLICY %s ON (COUNTRY_CODE)' % pol) if pol else ''
        self.sql(
            "CREATE OR REPLACE DYNAMIC TABLE %s COPY GRANTS TARGET_LAG = %s WAREHOUSE = %s%s AS "
            "WITH changes AS (SELECT %s, _COMMIT_TIME AS valid_from, _CHANGE_TYPE, _IS_UPDATE "
            "FROM %s.MDM.\"%s$CHANGES\" WHERE _CHANGE_TYPE = 'I' OR NOT _IS_UPDATE) "
            "SELECT %s, changes.valid_from, "
            "COALESCE(LEAD(changes.valid_from) OVER (PARTITION BY changes.id ORDER BY changes.valid_from), t.deleted_at) AS valid_to, "
            "(LEAD(changes.valid_from) OVER (PARTITION BY changes.id ORDER BY changes.valid_from) IS NULL AND t.deleted_at IS NULL) AS is_current, "
            "COUNT_IF(changes._CHANGE_TYPE = 'I') OVER (PARTITION BY changes.id ORDER BY changes.valid_from ROWS UNBOUNDED PRECEDING) AS version_number, "
            "changes._CHANGE_TYPE AS change_type "
            "FROM changes LEFT JOIN (SELECT record_id, MAX(deleted_at) AS deleted_at FROM %s.MDM.DELETED_RECORD "
            "WHERE table_name = %s GROUP BY record_id) t ON t.record_id = changes.id::STRING AND t.deleted_at >= changes.valid_from "
            "QUALIFY change_type = 'I'"
            % (dt, lit(lag), WH, rap, sel, MIRROR, x['T'], out, MIRROR, lit(x['table'])))
        return 'rebuilt'

    def pii_tags(self, x):
        arr = ', '.join(lit(c.lower()) for c in x['pii'])
        self.sql("CALL %s.SET_PII_COLUMNS(%s, ARRAY_CONSTRUCT(%s))" % (G, lit(x['T']), arr))

    def publish(self, x):
        cols = [f['name'].upper() for f in x['fields']
                if f.get('builtin') is not False and f.get('group') not in UNPUBLISHED_GROUPS
                and f['name'] not in NOT_PUBLISHED]
        label = x['m'].get('label', x['id'])
        src = '%s.V_CURRENT_%s' % (A, x['T'])
        extra = ''.join('%s, ' % c for c in cols)
        self.sql(
            "CREATE OR REPLACE SECURE VIEW %s.%s_GOLDEN COPY GRANTS COMMENT = %s AS "
            "SELECT COALESCE(golden_id, id::STRING) AS golden_id, id AS survivor_record_id, "
            "source_system AS survivor_source_system, %s%s AS last_updated FROM %s WHERE is_deleted = FALSE"
            % (P, x['M'], lit('%s: one row per golden record (survivors only)' % label), extra, x['ts'], src))
        self.sql(
            "CREATE OR REPLACE SECURE VIEW %s.%s_XREF COPY GRANTS COMMENT = %s AS "
            "SELECT source_system, source_id, id AS record_id, COALESCE(golden_id, id::STRING) AS golden_id, "
            "IFF(is_deleted, 'MERGED_OR_DELETED', 'SURVIVOR') AS record_status, %s AS last_updated FROM %s"
            % (P, x['M'], lit('%s: source record -> golden record' % label), x['ts'], src))

    def view_360(self, x):
        e = 'e'
        joins, extra, taken = [], [], set(x['colset'])

        def add(col, expr):
            if col not in taken:
                taken.add(col)
                extra.append('%s AS %s' % (expr, col))

        for i, f in enumerate(x['fields']):
            n = f['name'].upper()
            base = n[:-5] if n.endswith('_CODE') else n
            if f.get('ref_table') == 'mdm.ref_country':
                joins.append('LEFT JOIN %s.V_CURRENT_REF_COUNTRY j%d ON j%d.code = %s.%s' % (A, i, i, e, n))
                add(base + '_NAME', 'j%d.name' % i)
                add(base + '_REGION', 'j%d.region' % i)
            elif f.get('ref_table') == 'mdm.ref_currency':
                joins.append('LEFT JOIN %s.V_CURRENT_REF_CURRENCY j%d ON j%d.code = %s.%s' % (A, i, i, e, n))
                add(base + '_NAME', 'j%d.name' % i)
                add(base + '_SYMBOL', 'j%d.symbol' % i)
            elif isinstance(f.get('ref_domain'), str) and CODE.match(f['ref_domain']):
                joins.append("LEFT JOIN %s.V_CURRENT_REF_CODELIST j%d ON j%d.domain = %s AND j%d.code = %s.%s AND j%d.is_active"
                             % (A, i, i, lit(f['ref_domain']), i, e, n, i))
                add(n + '_LABEL', 'j%d.label' % i)
        # Configured joins (e.g. product category): only "<alias>.<col> = {table}.<col>" is accepted
        for j in x['m'].get('joins') or []:
            alias = ident(j.get('alias'), 'join alias')
            jschema, _, jtable = str(j.get('table', '')).partition('.')
            if jschema != 'mdm':
                continue
            jt = ident(jtable, 'join table').upper()
            mo = re.match(r'^\s*(\w+)\.(\w+)\s*=\s*\{table\}\.(\w+)\s*$', str(j.get('on', '')))
            if not mo or mo.group(1) != alias:
                continue
            a_col, e_col = ident(mo.group(2), 'join column'), ident(mo.group(3), 'join column')
            if e_col.upper() not in x['colset']:
                continue
            joins.append('LEFT JOIN %s.V_CURRENT_%s %s ON %s.%s = %s.%s' % (A, jt, alias, alias, a_col, e, e_col))
            for out, expr in (j.get('columns') or {}).items():
                me = re.match(r'^(\w+)\.(\w+)$', str(expr))
                if me and me.group(1) == alias and IDENT.match(out) and IDENT.match(me.group(2)):
                    add(out.upper(), '%s.%s' % (alias, me.group(2)))
        hier = x['m'].get('hierarchy') or {}
        pf = hier.get('parent_field')
        if hier.get('type') == 'self' and isinstance(pf, str) and IDENT.match(pf) and pf.upper() in x['colset'] and x['name_field']:
            joins.append('LEFT JOIN %s.V_CURRENT_%s par ON par.id = %s.%s' % (A, x['T'], e, pf))
            add('PARENT_NAME', 'par.' + x['name_field'])
        M = lit(x['M'])
        joins.append(
            "LEFT JOIN (SELECT entity_id, workflow_type, current_stage, assigned_to, "
            "ROW_NUMBER() OVER (PARTITION BY entity_id ORDER BY created_at DESC) AS rn "
            "FROM %s.V_CURRENT_WORKFLOW_INSTANCE WHERE completed_at IS NULL AND entity_type = %s) w "
            "ON w.entity_id = %s.id AND w.rn = 1" % (A, M, e))
        joins.append(
            "LEFT JOIN (SELECT entity_id_a AS entity_id, COUNT(*) AS match_count, MAX(match_score) AS max_match_score "
            "FROM %s.V_CURRENT_MATCH_CANDIDATE WHERE status = 'PENDING' AND entity_type = %s GROUP BY entity_id_a) mc "
            "ON mc.entity_id = %s.id" % (A, M, e))
        joins.append(
            "LEFT JOIN (SELECT entity_id, MAX(performed_at) AS last_change_at, "
            "COUNT_IF(performed_at >= DATEADD('day', -30, CURRENT_TIMESTAMP())) AS change_count_30d "
            "FROM %s.V_CURRENT_AUDIT_LOG WHERE entity_type = %s GROUP BY entity_id) au ON au.entity_id = %s.id"
            % (A, M, e))
        for col, expr in (('ACTIVE_WORKFLOW_TYPE', 'w.workflow_type'), ('WORKFLOW_STAGE', 'w.current_stage'),
                          ('WORKFLOW_ASSIGNEE', 'w.assigned_to'), ('MATCH_COUNT', 'mc.match_count'),
                          ('MAX_MATCH_SCORE', 'mc.max_match_score'), ('LAST_CHANGE_AT', 'au.last_change_at'),
                          ('CHANGE_COUNT_30D', 'au.change_count_30d')):
            add(col, expr)
        self.sql(
            "CREATE OR REPLACE VIEW %s.V_%s_360 COPY GRANTS COMMENT = %s AS SELECT %s.*%s FROM %s.V_CURRENT_%s %s %s "
            "WHERE %s.is_deleted = FALSE"
            % (A, x['T'], lit('%s 360: record, reference labels, workflow, duplicates, activity' % x['m'].get('label', x['id'])),
               e, ''.join(', ' + c for c in extra), A, x['T'], e, ' '.join(joins), e))

    # ── shared objects over the enabled modules ──
    def shared(self, mods):
        kpis = []
        for x in mods:
            live = self.live_stage(x['M'])
            kpis.append(
                "SELECT %s AS entity_type, COUNT(*) AS total_records, COUNT(DISTINCT golden_id) AS golden_records, "
                "AVG(dq_score)::DECIMAL(5,2) AS avg_dq_score, AVG(completeness)::DECIMAL(5,2) AS avg_completeness, "
                "COUNT_IF(lifecycle_stage = %s) AS active_count, COUNT_IF(lifecycle_stage = 'DRAFT') AS draft_count, "
                "COUNT_IF(dq_score < 60) AS low_quality_count FROM %s.V_CURRENT_%s WHERE is_deleted = FALSE"
                % (lit(x['M']), lit(live), A, x['T']))
        if kpis:
            self.sql("CREATE OR REPLACE VIEW %s.V_MDM_KPIS COPY GRANTS AS %s" % (A, ' UNION ALL '.join(kpis)))
        names = ' '.join("WHEN %s THEN (SELECT %s FROM %s.V_CURRENT_%s WHERE id = w.entity_id)"
                         % (lit(x['M']), x['name_field'], A, x['T']) for x in mods if x['name_field'])
        self.sql(
            "CREATE OR REPLACE VIEW %s.V_WORKFLOW_QUEUE COPY GRANTS AS SELECT w.id, w.entity_type, w.entity_id, "
            "w.workflow_type, w.current_stage, w.assigned_to, w.assigned_role, w.priority, w.created_at, "
            "DATEDIFF('day', w.created_at, CURRENT_TIMESTAMP()) AS age_days, %s AS entity_name "
            "FROM %s.V_CURRENT_WORKFLOW_INSTANCE w WHERE w.completed_at IS NULL "
            "ORDER BY CASE w.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, w.created_at"
            % (A, ('CASE w.entity_type %s END' % names) if names else 'NULL', A))

    def entity_country(self, all_mods):
        # null_country_visible: module option country_null_all ("no country = every market")
        parts = ["SELECT %s AS entity_type, id::STRING AS entity_id, country_code, %s AS null_country_visible "
                 "FROM %s.MDM.%s QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY %s DESC) = 1"
                 % (lit(x['M']), 'TRUE' if x['m'].get('country_null_all') else 'FALSE', MIRROR, x['T'], x['ts'])
                 for x in all_mods if x['country']]
        if parts:
            self.sql("CREATE OR REPLACE SECURE VIEW %s.V_ENTITY_COUNTRY AS %s" % (G, ' UNION ALL '.join(parts)))

    def semantic_view(self, mods, cfg):
        def syn(*words):
            seen = []
            for w in words:
                if isinstance(w, str) and w.strip() and w.strip().lower() not in seen:
                    seen.append(w.strip().lower())
            return (' with synonyms=(%s)' % ', '.join(lit(w) for w in seen)) if seen else ''

        def values(vals):
            return ('. Valid values: ' + ', '.join(vals)) if vals else ''

        tables = ['%s.V_CURRENT_%s comment=%s' % (A, x['T'], lit('%s master records - current state' % x['m'].get('singular', x['id'])))
                  for x in mods]
        tables += [
            "%s.V_CURRENT_MATCH_CANDIDATE comment='Potential duplicate pairs'" % A,
            "%s.V_CURRENT_WORKFLOW_INSTANCE comment='Governance workflows'" % A,
            "%s.V_CURRENT_AUDIT_LOG comment='Field-level change audit trail'" % A,
            "%s.V_CURRENT_REF_COUNTRY primary key (CODE) comment='Country reference data with name and region'" % A,
            "%s.V_CURRENT_REF_CURRENCY primary key (CODE) comment='Currency reference data with name and symbol'" % A,
            "%s.V_CURRENT_REF_CODELIST comment='Reference code lists (domain, code, label)'" % A,
        ]
        rels, facts, dims = [], [], []
        pii_all = set()
        for x in mods:
            V = 'V_CURRENT_' + x['T']
            sing = x['m'].get('singular', x['id'])
            sing_fr = (x['m'].get('singular_labels') or {}).get('fr')
            pii_all |= set(x['pii'])
            if 'DQ_SCORE' in x['colset']:
                facts.append("%s.DQ_SCORE as DQ_SCORE%s comment=%s" % (V, syn(sing + ' quality', 'data quality score'), lit(sing + ' DQ score 0-100')))
            if 'COMPLETENESS' in x['colset']:
                facts.append("%s.COMPLETENESS as COMPLETENESS comment=%s" % (V, lit(sing + ' completeness 0-100')))
            dims.append("%s.LIFECYCLE_STAGE as LIFECYCLE_STAGE%s comment=%s"
                        % (V, syn('status', sing + ' stage'), lit(sing + ' lifecycle stage' + values(self.stages(x['M'])))))
            dims.append("%s.SOURCE_SYSTEM as SOURCE_SYSTEM comment=%s" % (V, lit('System that supplied the ' + sing.lower())))
            dims.append("%s.IS_DELETED as IS_DELETED comment='Soft-delete flag. Filter with IS_DELETED = FALSE for active records'" % V)
            for f in x['fields']:
                n = f['name'].upper()
                if n in ('LIFECYCLE_STAGE', 'SOURCE_SYSTEM', 'IS_DELETED', 'DQ_SCORE', 'COMPLETENESS', 'ID') or n in x['pii']:
                    continue
                label = f.get('label') or f['name']
                fr = (f.get('labels') or {}).get('fr')
                t = f.get('type')
                if f.get('ref_table') in ('mdm.ref_country', 'mdm.ref_currency'):
                    target = 'V_CURRENT_REF_COUNTRY' if f['ref_table'] == 'mdm.ref_country' else 'V_CURRENT_REF_CURRENCY'
                    rels.append('%s_%s_REF as %s(%s) references %s(CODE)' % (x['T'], n, V, n, target))
                if t == 'number' and not n.endswith('_ID'):
                    facts.append("%s.%s as %s%s comment=%s" % (V, n, n, syn(label, fr), lit('%s %s' % (sing, label))))
                elif t in ('text', 'ref', 'boolean', 'date'):
                    vals = self.codes(f['ref_domain']) if isinstance(f.get('ref_domain'), str) and CODE.match(f['ref_domain']) else []
                    words = (label, fr, sing, sing_fr) if f['name'] == x['name_field'] else (label, fr)
                    dims.append("%s.%s as %s%s comment=%s" % (V, n, n, syn(*words), lit('%s %s%s' % (sing, label, values(vals)))))
        types = sorted({t for m in cfg.get('modules', []) for t in ((m.get('workflow') or {}).get('types') or [])
                        if isinstance(t, str) and CODE.match(t)})
        entity_types = ', '.join(x['M'] for x in mods)
        dims += [
            "V_CURRENT_MATCH_CANDIDATE.ENTITY_TYPE as ENTITY_TYPE comment=%s" % lit('Entity type. Valid values: ' + entity_types),
            "V_CURRENT_MATCH_CANDIDATE.STATUS as STATUS comment='Match status. Valid values: PENDING, CONFIRMED, MERGED, REJECTED'",
            "V_CURRENT_WORKFLOW_INSTANCE.ENTITY_TYPE as ENTITY_TYPE comment=%s" % lit('Entity type. Valid values: ' + entity_types),
            "V_CURRENT_WORKFLOW_INSTANCE.WORKFLOW_TYPE as WORKFLOW_TYPE comment=%s" % lit('Workflow type' + values(types)),
            "V_CURRENT_WORKFLOW_INSTANCE.CURRENT_STAGE as CURRENT_STAGE comment='Current workflow step'",
            "V_CURRENT_WORKFLOW_INSTANCE.PRIORITY as PRIORITY comment='Workflow priority. Valid values: CRITICAL, HIGH, MEDIUM, LOW'",
            "V_CURRENT_WORKFLOW_INSTANCE.ASSIGNED_TO as ASSIGNED_TO comment='Workflow assignee email'",
            "V_CURRENT_AUDIT_LOG.ENTITY_TYPE as ENTITY_TYPE comment=%s" % lit('Audited entity type. Valid values: ' + entity_types),
            "V_CURRENT_AUDIT_LOG.ACTION as ACTION comment='Audit action: INSERT, UPDATE, DELETE'",
            "V_CURRENT_AUDIT_LOG.PERFORMED_BY as PERFORMED_BY comment='User who made the change'",
            "V_CURRENT_REF_COUNTRY.NAME as NAME with synonyms=('country name','nom du pays') comment='Country name. Examples: France, Germany, United Kingdom'",
            "V_CURRENT_REF_COUNTRY.REGION as REGION with synonyms=('geographic region','zone') comment='Geographic region'",
            "V_CURRENT_REF_CURRENCY.NAME as NAME comment='Currency name. Examples: Euro, British Pound, Swiss Franc'",
            "V_CURRENT_REF_CURRENCY.SYMBOL as SYMBOL comment='Currency symbol'",
            "V_CURRENT_REF_CODELIST.DOMAIN as DOMAIN comment='Reference data domain'",
            "V_CURRENT_REF_CODELIST.CODE as CODE comment='Reference code value'",
            "V_CURRENT_REF_CODELIST.LABEL as LABEL comment='Human-readable label for the reference code'",
        ]
        facts.append("V_CURRENT_MATCH_CANDIDATE.MATCH_SCORE as MATCH_SCORE with synonyms=('similarity','duplicate score') comment='Match confidence 0-100'")
        sv = A + '.MDM_ANALYTICS_VIEW'
        # Keep the SELECT grants of the current view
        grantees = set()
        try:
            for r in self.sql('SHOW GRANTS ON SEMANTIC VIEW ' + sv):
                if r['privilege'] == 'SELECT' and r['granted_to'] == 'ROLE':
                    grantees.add(r['grantee_name'])
        except Exception:
            pass
        grantees |= {'MDM_VIEWER_ROLE', 'MDM_SERVICE_ROLE'}
        ddl = 'CREATE OR REPLACE SEMANTIC VIEW %s tables (%s)' % (sv, ', '.join(tables))
        if rels:
            ddl += ' relationships (%s)' % ', '.join(rels)
        ddl += ' facts (%s) dimensions (%s)' % (', '.join(facts), ', '.join(dims))
        ddl += " comment='MDM master data for Cortex Analyst (generated by SYNC_MODULES)'"
        self.sql(ddl)
        for g in sorted(grantees):
            if re.match(r'^[A-Z_][A-Z0-9_$]*$', g):
                self.sql('GRANT SELECT ON SEMANTIC VIEW %s TO ROLE %s' % (sv, g))
        return '%d modules, %d facts, %d dimensions' % (len(mods), len(facts), len(dims))

    def write_log(self):
        for module, status, detail in self.log_rows:
            self.sql("INSERT INTO %s.MDM_AI.MODULE_SYNC_LOG (config_version, module, status, detail) VALUES (%d, %s, %s, %s)"
                     % (DB, self.version, lit(module), lit(status), lit(detail)))


def run(session, min_version):
    rows = session.sql(
        "SELECT doc, version FROM %s.MDM.APP_CONFIG QUALIFY ROW_NUMBER() OVER (ORDER BY version DESC, updated_at DESC) = 1"
        % MIRROR).collect()
    if not rows:
        return json.dumps({'status': 'pending', 'reason': 'configuration not mirrored yet'})
    version = int(rows[0][1])
    if min_version is not None and version < int(min_version):
        return json.dumps({'status': 'pending', 'mirror_version': version})
    cfg = json.loads(rows[0][0])
    s = Sync(session, version)
    infos = []
    for m in cfg.get('modules', []):
        label = str(m.get('id'))
        try:
            x = s.module_info(m, cfg)
            if x is None:
                s.log(label, 'SKIPPED', 'table not in the mirror')
                continue
            pol = s.ensure_policy(x)
            view, rebuilt = s.current_view(x, pol)
            s.dmfs(view, x)
            hist = s.history(x, pol)
            s.pii_tags(x)
            s.publish(x)
            if x['enabled']:
                s.view_360(x)
            infos.append(x)
            s.log(x['id'], 'OK', 'view %s, history %s%s' % ('rebuilt' if rebuilt else 'unchanged', hist,
                                                           '' if x['enabled'] else ', disabled'))
        except Exception as e:
            s.log(label, 'ERROR', e)
    enabled = [x for x in infos if x['enabled']]
    try:
        s.entity_country(infos)
        s.shared(enabled)
        s.log('SHARED', 'OK', 'KPIs, workflow queue, entity country')
    except Exception as e:
        s.log('SHARED', 'ERROR', e)
    try:
        s.log('SEMANTIC_VIEW', 'OK', s.semantic_view(enabled, cfg))
    except Exception as e:
        s.log('SEMANTIC_VIEW', 'ERROR', e)
    s.write_log()
    errors = [r for r in s.log_rows if r[1] == 'ERROR']
    return json.dumps({'status': 'error' if errors else 'ok', 'config_version': version,
                       'results': [{'module': r[0], 'status': r[1], 'detail': r[2]} for r in s.log_rows]})
$$;

GRANT USAGE ON PROCEDURE <% database %>.MDM_ANALYTICS.SYNC_MODULES(NUMBER) TO ROLE MDM_SERVICE_ROLE;

CALL <% database %>.MDM_ANALYTICS.SYNC_MODULES(0);

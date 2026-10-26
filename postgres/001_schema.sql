-- ============================================================
-- MDM - Core Schema for Snowflake Postgres
-- Entities: Customer, Product
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- trigram fuzzy search / autocomplete
CREATE EXTENSION IF NOT EXISTS "ltree";       -- hierarchy management

CREATE SCHEMA IF NOT EXISTS mdm;
SET search_path TO mdm, public;

-- ============================================================
-- 1. REFERENCE DATA
-- ============================================================

CREATE TABLE mdm.ref_country (
    code        VARCHAR(3) PRIMARY KEY,
    name        VARCHAR(120) NOT NULL,
    region      VARCHAR(60)
);

CREATE TABLE mdm.ref_language (
    code        VARCHAR(5) PRIMARY KEY,
    name        VARCHAR(60) NOT NULL
);

CREATE TABLE mdm.ref_currency (
    code        VARCHAR(3) PRIMARY KEY,
    name        VARCHAR(60) NOT NULL,
    symbol      VARCHAR(5)
);

CREATE TABLE mdm.ref_lifecycle_stage (
    id          SERIAL PRIMARY KEY,
    entity_type VARCHAR(20) NOT NULL,       -- 'CUSTOMER' | 'PRODUCT'
    stage_code  VARCHAR(30) NOT NULL,
    stage_label VARCHAR(80) NOT NULL,
    sort_order  INT NOT NULL DEFAULT 0,
    is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(entity_type, stage_code)
);

CREATE TABLE mdm.ref_lifecycle_transition (
    id              SERIAL PRIMARY KEY,
    entity_type     VARCHAR(20) NOT NULL,
    from_stage_code VARCHAR(30) NOT NULL,
    to_stage_code   VARCHAR(30) NOT NULL,
    required_role   VARCHAR(60),
    UNIQUE(entity_type, from_stage_code, to_stage_code)
);

-- ============================================================
-- 2. DATA MODEL METADATA (dynamic attribute engine)
-- ============================================================

CREATE TABLE mdm.attribute_definition (
    id              SERIAL PRIMARY KEY,
    entity_type     VARCHAR(20) NOT NULL,
    attribute_key   VARCHAR(80) NOT NULL,
    display_label   VARCHAR(120) NOT NULL,
    data_type       VARCHAR(20) NOT NULL DEFAULT 'TEXT',  -- TEXT, NUMBER, DATE, BOOLEAN, LOV, JSON
    is_mandatory    BOOLEAN NOT NULL DEFAULT FALSE,
    mandatory_at_stage VARCHAR(30),          -- mandatory only at this lifecycle stage
    category        VARCHAR(60),             -- product category filter (NULL = all)
    lov_values      JSONB,                   -- list of values for LOV type
    validation_regex VARCHAR(200),
    sort_order      INT NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(entity_type, attribute_key)
);

-- ============================================================
-- 3. CUSTOMER MASTER
-- ============================================================

CREATE TABLE mdm.customer (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    golden_id       VARCHAR(40),             -- golden record identifier
    source_system   VARCHAR(40) NOT NULL,
    source_id       VARCHAR(80) NOT NULL,
    lifecycle_stage VARCHAR(30) NOT NULL DEFAULT 'DRAFT',

    -- Core attributes
    legal_name      VARCHAR(200) NOT NULL,
    trade_name      VARCHAR(200),
    tax_id          VARCHAR(40),
    duns_number     VARCHAR(15),
    siren           VARCHAR(20),
    siret           VARCHAR(20),

    -- Address
    address_line1   VARCHAR(200),
    address_line2   VARCHAR(200),
    city            VARCHAR(100),
    state_province  VARCHAR(100),
    postal_code     VARCHAR(20),
    country_code    VARCHAR(3) REFERENCES mdm.ref_country(code),

    -- Contact
    phone           VARCHAR(40),
    email           VARCHAR(200),
    website         VARCHAR(300),

    -- Classification
    customer_type   VARCHAR(30),             -- PROSPECT, SMB, ENTERPRISE, PUBLIC_SECTOR
    segment         VARCHAR(30),             -- OFFICE, INDUSTRIAL, HOSPITALITY, HEALTHCARE
    industry_code   VARCHAR(20),

    -- Hierarchy
    parent_id       UUID REFERENCES mdm.customer(id),
    hierarchy_path  LTREE,
    hierarchy_level INT,

    -- Dynamic attributes (EAV overflow)
    extended_attrs  JSONB NOT NULL DEFAULT '{}',

    -- Data quality
    dq_score        NUMERIC(5,2),
    completeness    NUMERIC(5,2),
    last_dq_check   TIMESTAMPTZ,

    -- Enrichment
    dnb_enriched    BOOLEAN NOT NULL DEFAULT FALSE,
    dnb_enriched_at TIMESTAMPTZ,

    -- Metadata
    created_by      VARCHAR(80) NOT NULL DEFAULT CURRENT_USER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by      VARCHAR(80) NOT NULL DEFAULT CURRENT_USER,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,

    UNIQUE(source_system, source_id)
);

CREATE INDEX idx_customer_golden ON mdm.customer(golden_id);
CREATE INDEX idx_customer_name_trgm ON mdm.customer USING gin(legal_name gin_trgm_ops);
CREATE INDEX idx_customer_trade_trgm ON mdm.customer USING gin(trade_name gin_trgm_ops);
CREATE INDEX idx_customer_hierarchy ON mdm.customer USING gist(hierarchy_path);
CREATE INDEX idx_customer_lifecycle ON mdm.customer(lifecycle_stage);
CREATE INDEX idx_customer_country ON mdm.customer(country_code);
CREATE INDEX idx_customer_segment ON mdm.customer(segment);
CREATE INDEX idx_customer_parent ON mdm.customer(parent_id);
CREATE INDEX idx_customer_dq ON mdm.customer(dq_score);

-- ============================================================
-- 4. PRODUCT MASTER
-- ============================================================

CREATE TABLE mdm.product_category (
    id              SERIAL PRIMARY KEY,
    code            VARCHAR(40) NOT NULL UNIQUE,
    name            VARCHAR(120) NOT NULL,
    parent_id       INT REFERENCES mdm.product_category(id),
    hierarchy_path  LTREE,
    level           INT NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_prodcat_hierarchy ON mdm.product_category USING gist(hierarchy_path);

CREATE TABLE mdm.product (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    golden_id       VARCHAR(40),
    source_system   VARCHAR(40) NOT NULL,
    source_id       VARCHAR(80) NOT NULL,
    lifecycle_stage VARCHAR(30) NOT NULL DEFAULT 'DRAFT',

    -- Core attributes
    sku             VARCHAR(60),
    ean             VARCHAR(20),
    name            VARCHAR(300) NOT NULL,
    short_desc      VARCHAR(500),
    long_desc       TEXT,
    brand           VARCHAR(120),
    manufacturer    VARCHAR(200),

    -- Classification
    category_id     INT REFERENCES mdm.product_category(id),
    product_type    VARCHAR(40),             -- STANDARD, SERVICE, BUNDLE, CUSTOM
    unit_of_measure VARCHAR(20),

    -- Dimensions
    weight_kg       NUMERIC(10,3),
    length_cm       NUMERIC(10,2),
    width_cm        NUMERIC(10,2),
    height_cm       NUMERIC(10,2),

    -- Pricing
    list_price      NUMERIC(12,2),
    currency_code   VARCHAR(3) REFERENCES mdm.ref_currency(code),

    -- Compliance
    hazardous       BOOLEAN NOT NULL DEFAULT FALSE,
    esg_rating      VARCHAR(10),
    certifications  JSONB DEFAULT '[]',

    -- Localization
    translations    JSONB DEFAULT '{}',      -- {"fr": {"name": "...", "desc": "..."}, ...}

    -- Hierarchy
    parent_id       UUID REFERENCES mdm.product(id),
    hierarchy_path  LTREE,

    -- Dynamic attributes
    extended_attrs  JSONB NOT NULL DEFAULT '{}',

    -- Data quality
    dq_score        NUMERIC(5,2),
    completeness    NUMERIC(5,2),
    last_dq_check   TIMESTAMPTZ,

    -- Digital assets
    primary_image   VARCHAR(500),
    assets          JSONB DEFAULT '[]',      -- [{type, url, label}, ...]

    -- Metadata
    created_by      VARCHAR(80) NOT NULL DEFAULT CURRENT_USER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by      VARCHAR(80) NOT NULL DEFAULT CURRENT_USER,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,

    UNIQUE(source_system, source_id)
);

CREATE INDEX idx_product_golden ON mdm.product(golden_id);
CREATE INDEX idx_product_sku ON mdm.product(sku);
CREATE INDEX idx_product_ean ON mdm.product(ean);
CREATE INDEX idx_product_name_trgm ON mdm.product USING gin(name gin_trgm_ops);
CREATE INDEX idx_product_brand_trgm ON mdm.product USING gin(brand gin_trgm_ops);
CREATE INDEX idx_product_hierarchy ON mdm.product USING gist(hierarchy_path);
CREATE INDEX idx_product_lifecycle ON mdm.product(lifecycle_stage);
CREATE INDEX idx_product_category ON mdm.product(category_id);
CREATE INDEX idx_product_dq ON mdm.product(dq_score);

-- ============================================================
-- 5. MATCH & MERGE
-- ============================================================

CREATE TABLE mdm.match_candidate (
    id              SERIAL PRIMARY KEY,
    entity_type     VARCHAR(20) NOT NULL,
    entity_id_a     UUID NOT NULL,
    entity_id_b     UUID NOT NULL,
    match_score     NUMERIC(5,2) NOT NULL,
    match_method    VARCHAR(40) NOT NULL,    -- EXACT, FUZZY, AI_CORTEX, DNB
    match_fields    JSONB,                   -- which fields matched
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',  -- PENDING, CONFIRMED, REJECTED, AUTO_MERGED
    reviewed_by     VARCHAR(80),
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_match_entity ON mdm.match_candidate(entity_type, status);

CREATE TABLE mdm.merge_history (
    id              SERIAL PRIMARY KEY,
    entity_type     VARCHAR(20) NOT NULL,
    survivor_id     UUID NOT NULL,
    merged_id       UUID NOT NULL,
    survivorship    JSONB NOT NULL,          -- field-level source decisions
    merged_by       VARCHAR(80) NOT NULL,
    merged_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 6. WORKFLOW
-- ============================================================

CREATE TABLE mdm.workflow_instance (
    id              SERIAL PRIMARY KEY,
    entity_type     VARCHAR(20) NOT NULL,
    entity_id       UUID NOT NULL,
    workflow_type   VARCHAR(40) NOT NULL,    -- ONBOARDING, UPDATE, MERGE, DEACTIVATION
    current_stage   VARCHAR(30) NOT NULL,
    assigned_to     VARCHAR(80),
    assigned_role   VARCHAR(60),
    priority        VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
    due_date        DATE,
    notes           TEXT,
    created_by      VARCHAR(80) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_workflow_active ON mdm.workflow_instance(current_stage, assigned_to)
    WHERE completed_at IS NULL;
CREATE INDEX idx_workflow_entity ON mdm.workflow_instance(entity_type, entity_id);

CREATE TABLE mdm.workflow_step_log (
    id              SERIAL PRIMARY KEY,
    workflow_id     INT NOT NULL REFERENCES mdm.workflow_instance(id),
    from_stage      VARCHAR(30),
    to_stage        VARCHAR(30) NOT NULL,
    action          VARCHAR(30) NOT NULL,    -- APPROVE, REJECT, ESCALATE, REASSIGN
    performed_by    VARCHAR(80) NOT NULL,
    comment         TEXT,
    performed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 7. AUDIT TRAIL
-- ============================================================

CREATE TABLE mdm.audit_log (
    id              BIGSERIAL PRIMARY KEY,
    entity_type     VARCHAR(20) NOT NULL,
    entity_id       UUID NOT NULL,
    action          VARCHAR(10) NOT NULL,    -- INSERT, UPDATE, DELETE
    changed_fields  JSONB,                   -- {field: {old: ..., new: ...}}
    full_record     JSONB,                   -- snapshot of the record
    performed_by    VARCHAR(80) NOT NULL,
    performed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_info    JSONB                    -- IP, user agent, etc.
);

CREATE INDEX idx_audit_entity ON mdm.audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_time ON mdm.audit_log(performed_at);
CREATE INDEX idx_audit_user ON mdm.audit_log(performed_by);

-- ============================================================
-- 8. DATA QUALITY RULES
-- ============================================================

CREATE TABLE mdm.dq_rule (
    id              SERIAL PRIMARY KEY,
    entity_type     VARCHAR(20) NOT NULL,
    rule_code       VARCHAR(60) NOT NULL UNIQUE,
    rule_name       VARCHAR(200) NOT NULL,
    rule_type       VARCHAR(30) NOT NULL,    -- COMPLETENESS, VALIDITY, CONSISTENCY, UNIQUENESS, TIMELINESS
    category        VARCHAR(60),             -- product category filter (NULL = all)
    sql_expression  TEXT NOT NULL,            -- boolean SQL expression
    severity        VARCHAR(10) NOT NULL DEFAULT 'WARNING',  -- ERROR, WARNING, INFO
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE mdm.dq_result (
    id              BIGSERIAL PRIMARY KEY,
    rule_id         INT NOT NULL REFERENCES mdm.dq_rule(id),
    entity_type     VARCHAR(20) NOT NULL,
    entity_id       UUID NOT NULL,
    passed          BOOLEAN NOT NULL,
    details         JSONB,
    evaluated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dq_result_entity ON mdm.dq_result(entity_type, entity_id);
CREATE INDEX idx_dq_result_rule ON mdm.dq_result(rule_id, passed);

-- ============================================================
-- 9. COMMENTS / NOTES
-- ============================================================

CREATE TABLE mdm.entity_comment (
    id              SERIAL PRIMARY KEY,
    entity_type     VARCHAR(20) NOT NULL,
    entity_id       UUID NOT NULL,
    comment_text    TEXT NOT NULL,
    created_by      VARCHAR(80) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_comment_entity ON mdm.entity_comment(entity_type, entity_id);

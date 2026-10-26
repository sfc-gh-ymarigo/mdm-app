-- ============================================================
-- Customers — Postgres DDL (generated from config.json)
-- ============================================================

CREATE TABLE IF NOT EXISTS mdm.customer (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    golden_id       VARCHAR(40),
    source_system   VARCHAR(40) NOT NULL,
    source_id       VARCHAR(80) NOT NULL,
    lifecycle_stage VARCHAR(30) NOT NULL DEFAULT 'DRAFT',

    -- Core
    legal_name           VARCHAR(200) NOT NULL,
    trade_name           VARCHAR(200),

    -- Identifiers
    tax_id               VARCHAR(40),
    duns_number          VARCHAR(15),
    siren                VARCHAR(20),
    siret                VARCHAR(20),
    lei_code             VARCHAR(20),
    vat_number           VARCHAR(30),
    registration_number  VARCHAR(40),
    eori_number          VARCHAR(20),
    global_location_number VARCHAR(13),

    -- Address
    address_line1        VARCHAR(200),
    address_line2        VARCHAR(200),
    address_line3        VARCHAR(200),
    city                 VARCHAR(100),
    state_province       VARCHAR(100),
    postal_code          VARCHAR(20),
    country_code         VARCHAR(3) REFERENCES mdm.ref_country(code),
    region               VARCHAR(60),
    latitude             NUMERIC(10,7),
    longitude            NUMERIC(10,7),

    -- Contact
    phone                VARCHAR(40),
    email                VARCHAR(200),
    website              VARCHAR(300),
    fax                  VARCHAR(40),
    linkedin_url         VARCHAR(300),
    primary_contact_name VARCHAR(200),
    primary_contact_email VARCHAR(200),
    primary_contact_phone VARCHAR(40),

    -- Classification
    customer_type        VARCHAR(30),
    segment              VARCHAR(30),
    industry_code        VARCHAR(20),
    nace_code            VARCHAR(10),
    naics_code           VARCHAR(10),
    sic_code             VARCHAR(10),
    legal_form           VARCHAR(60),

    -- Financials
    employee_count       NUMERIC,
    annual_revenue       NUMERIC(15,2),
    revenue_currency     VARCHAR(3) REFERENCES mdm.ref_currency(code),
    credit_limit         NUMERIC(15,2),
    payment_terms        VARCHAR(40),
    bank_account_iban    VARCHAR(34),

    -- Legal
    incorporation_date   DATE,
    is_publicly_traded   BOOLEAN,
    stock_ticker         VARCHAR(10),

    -- Compliance
    gdpr_consent         BOOLEAN,
    sanctions_checked    BOOLEAN,
    sanctions_check_date DATE,
    kyc_status           VARCHAR(30),
    risk_rating          VARCHAR(20),

    -- Hierarchy

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

    -- Metadata
    created_by      VARCHAR(80) NOT NULL DEFAULT CURRENT_USER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by      VARCHAR(80) NOT NULL DEFAULT CURRENT_USER,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,

    UNIQUE(source_system, source_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_customer_golden ON mdm.customer(golden_id);
CREATE INDEX IF NOT EXISTS idx_customer_lifecycle ON mdm.customer(lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_customer_dq ON mdm.customer(dq_score);
CREATE INDEX IF NOT EXISTS idx_customer_legal_name_trgm ON mdm.customer USING gin(legal_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customer_trade_name_trgm ON mdm.customer USING gin(trade_name gin_trgm_ops);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_tax_id_uniq ON mdm.customer(tax_id) WHERE tax_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_country_code ON mdm.customer(country_code);
CREATE INDEX IF NOT EXISTS idx_customer_customer_type ON mdm.customer(customer_type);
CREATE INDEX IF NOT EXISTS idx_customer_segment ON mdm.customer(segment);
CREATE INDEX IF NOT EXISTS idx_customer_country ON mdm.customer(country_code);
CREATE INDEX IF NOT EXISTS idx_customer_hierarchy ON mdm.customer USING gist(hierarchy_path);
CREATE INDEX IF NOT EXISTS idx_customer_parent ON mdm.customer(parent_id);

-- Audit trigger
CREATE TRIGGER trg_customer_audit
    AFTER INSERT OR UPDATE OR DELETE ON mdm.customer
    FOR EACH ROW EXECUTE FUNCTION mdm.fn_audit_trigger('CUSTOMER');

-- Auto-update timestamp
CREATE TRIGGER trg_customer_updated
    BEFORE UPDATE ON mdm.customer
    FOR EACH ROW EXECUTE FUNCTION mdm.fn_set_updated_at();

-- Hierarchy path trigger
CREATE TRIGGER trg_customer_hierarchy
    BEFORE INSERT OR UPDATE OF parent_id ON mdm.customer
    FOR EACH ROW EXECUTE FUNCTION mdm.fn_update_hierarchy_path();

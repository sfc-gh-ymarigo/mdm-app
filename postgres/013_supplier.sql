-- 013: Supplier module table (from generated/pg_supplier.sql).
-- Created so the module is correct when enabled; it stays disabled in config until then.

CREATE TABLE IF NOT EXISTS mdm.supplier (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    golden_id       VARCHAR(40),
    source_system   VARCHAR(40) NOT NULL,
    source_id       VARCHAR(80) NOT NULL,
    lifecycle_stage VARCHAR(30) NOT NULL DEFAULT 'DRAFT',

    -- Core
    company_name         VARCHAR(200) NOT NULL,
    trade_name           VARCHAR(200),

    -- Identifiers
    tax_id               VARCHAR(40),
    vat_number           VARCHAR(30),
    duns_number          VARCHAR(15),
    siren                VARCHAR(20),
    global_location_number VARCHAR(13),

    -- Address
    address_line1        VARCHAR(200),
    address_line2        VARCHAR(200),
    city                 VARCHAR(100),
    state_province       VARCHAR(100),
    postal_code          VARCHAR(20),
    country_code         VARCHAR(3) REFERENCES mdm.ref_country(code),
    latitude             NUMERIC(10,7),
    longitude            NUMERIC(10,7),

    -- Contact
    phone                VARCHAR(40),
    email                VARCHAR(200),
    website              VARCHAR(300),
    primary_contact_name VARCHAR(200),
    primary_contact_email VARCHAR(200),

    -- Classification
    supplier_type        VARCHAR(30),
    supplier_tier        VARCHAR(20),
    industry_code        VARCHAR(20),
    nace_code            VARCHAR(10),

    -- Commercial
    payment_terms        VARCHAR(40),
    lead_time_days       NUMERIC,
    incoterms            VARCHAR(10),
    currency_code        VARCHAR(3) REFERENCES mdm.ref_currency(code),
    min_order_value      NUMERIC(12,2),
    annual_spend         NUMERIC(15,2),

    -- Financial
    bank_account_iban    VARCHAR(34),
    bank_name            VARCHAR(120),
    bank_swift_bic       VARCHAR(11),

    -- Compliance
    iso9001_certified    BOOLEAN,
    iso14001_certified   BOOLEAN,
    iso45001_certified   BOOLEAN,
    ecovadis_score       NUMERIC,
    risk_rating          VARCHAR(20),
    sanctions_checked    BOOLEAN,
    last_audit_date      DATE,

    -- Contract
    contract_start_date  DATE,
    contract_end_date    DATE,
    contract_reference   VARCHAR(60),

    -- Performance
    performance_score    NUMERIC,
    on_time_delivery_pct NUMERIC,
    defect_rate_pct      NUMERIC,

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
CREATE INDEX IF NOT EXISTS idx_supplier_golden ON mdm.supplier(golden_id);
CREATE INDEX IF NOT EXISTS idx_supplier_lifecycle ON mdm.supplier(lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_supplier_dq ON mdm.supplier(dq_score);
CREATE INDEX IF NOT EXISTS idx_supplier_company_name_trgm ON mdm.supplier USING gin(company_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_supplier_trade_name_trgm ON mdm.supplier USING gin(trade_name gin_trgm_ops);
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_tax_id_uniq ON mdm.supplier(tax_id) WHERE tax_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_supplier_type ON mdm.supplier(supplier_type);
CREATE INDEX IF NOT EXISTS idx_supplier_country ON mdm.supplier(country_code);

-- Audit + updated_at triggers
DROP TRIGGER IF EXISTS trg_supplier_audit ON mdm.supplier;
CREATE TRIGGER trg_supplier_audit
    AFTER INSERT OR UPDATE OR DELETE ON mdm.supplier
    FOR EACH ROW EXECUTE FUNCTION mdm.fn_audit_trigger('SUPPLIER');

DROP TRIGGER IF EXISTS trg_supplier_updated ON mdm.supplier;
CREATE TRIGGER trg_supplier_updated
    BEFORE UPDATE ON mdm.supplier
    FOR EACH ROW EXECUTE FUNCTION mdm.fn_set_updated_at();

-- Country-scope RLS (same rule as customers)
ALTER TABLE mdm.supplier ENABLE ROW LEVEL SECURITY;
ALTER TABLE mdm.supplier FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_access ON mdm.supplier;
CREATE POLICY supplier_access ON mdm.supplier FOR ALL
    USING      (mdm.scope_allows('supplier', country_code))
    WITH CHECK (mdm.scope_allows('supplier', country_code));

GRANT SELECT, INSERT, UPDATE, DELETE ON mdm.supplier TO mdm_app;
GRANT SELECT ON mdm.supplier TO mdm_fn_owner;

INSERT INTO mdm.module_scope (module_id, table_name, country_scoped)
VALUES ('supplier', 'mdm.supplier', true)
ON CONFLICT (module_id) DO NOTHING;

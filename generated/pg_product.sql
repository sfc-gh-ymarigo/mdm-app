-- ============================================================
-- Products — Postgres DDL (generated from config.json)
-- ============================================================

CREATE TABLE IF NOT EXISTS mdm.product (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    golden_id       VARCHAR(40),
    source_system   VARCHAR(40) NOT NULL,
    source_id       VARCHAR(80) NOT NULL,
    lifecycle_stage VARCHAR(30) NOT NULL DEFAULT 'DRAFT',

    -- Core
    sku                  VARCHAR(60),
    ean                  VARCHAR(20),
    upc                  VARCHAR(20),
    gtin14               VARCHAR(14),
    isbn                 VARCHAR(17),
    mpn                  VARCHAR(60),
    name                 VARCHAR(300) NOT NULL,
    short_desc           VARCHAR(500),
    long_desc            TEXT,
    brand                VARCHAR(120),
    manufacturer         VARCHAR(200),
    manufacturer_part_number VARCHAR(60),

    -- Classification
    category_id          NUMERIC,
    product_type         VARCHAR(30),
    unit_of_measure      VARCHAR(30),
    product_group        VARCHAR(60),
    commodity_code       VARCHAR(20),
    customs_tariff       VARCHAR(20),
    unspsc_code          VARCHAR(16),

    -- Dimensions
    weight_kg            NUMERIC(10,3),
    weight_gross_kg      NUMERIC(10,3),
    length_cm            NUMERIC(10,2),
    width_cm             NUMERIC(10,2),
    height_cm            NUMERIC(10,2),
    volume_cm3           NUMERIC(12,2),
    pack_quantity        NUMERIC,
    pallet_quantity      NUMERIC,

    -- Pricing
    list_price           NUMERIC(12,4),
    cost_price           NUMERIC(12,4),
    msrp                 NUMERIC(12,4),
    currency_code        VARCHAR(3) REFERENCES mdm.ref_currency(code),
    min_order_qty        NUMERIC,

    -- Logistics
    country_of_origin    VARCHAR(3) REFERENCES mdm.ref_country(code),
    country_code         VARCHAR(3) REFERENCES mdm.ref_country(code),
    shelf_life_days      NUMERIC,
    storage_conditions   VARCHAR(200),
    is_returnable        BOOLEAN,
    lead_time_days       NUMERIC,

    -- Compliance
    hazardous            BOOLEAN,
    esg_rating           VARCHAR(30),
    reach_compliant      BOOLEAN,
    rohs_compliant       BOOLEAN,
    fsc_certified        BOOLEAN,
    carbon_footprint_kg  NUMERIC(10,3),
    recycled_content_pct NUMERIC,

    -- Media
    image_url            VARCHAR(500),
    datasheet_url        VARCHAR(500),

    -- Lifecycle
    is_discontinued      BOOLEAN,
    launch_date          DATE,
    end_of_life_date     DATE,

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
CREATE INDEX IF NOT EXISTS idx_product_golden ON mdm.product(golden_id);
CREATE INDEX IF NOT EXISTS idx_product_lifecycle ON mdm.product(lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_product_dq ON mdm.product(dq_score);
CREATE INDEX IF NOT EXISTS idx_product_name_trgm ON mdm.product USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_product_brand_trgm ON mdm.product USING gin(brand gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_product_brand ON mdm.product(brand);
CREATE INDEX IF NOT EXISTS idx_product_category_id ON mdm.product(category_id);
CREATE INDEX IF NOT EXISTS idx_product_country_code ON mdm.product(country_code);

-- Audit trigger
CREATE TRIGGER trg_product_audit
    AFTER INSERT OR UPDATE OR DELETE ON mdm.product
    FOR EACH ROW EXECUTE FUNCTION mdm.fn_audit_trigger('PRODUCT');

-- Auto-update timestamp
CREATE TRIGGER trg_product_updated
    BEFORE UPDATE ON mdm.product
    FOR EACH ROW EXECUTE FUNCTION mdm.fn_set_updated_at();

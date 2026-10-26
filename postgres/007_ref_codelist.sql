-- ============================================================
-- MDM Demo - Reference Data Manager: Generic Codelist Table
-- ============================================================

SET search_path TO mdm, public;

-- Generic codelist table for all non-structural reference data
CREATE TABLE IF NOT EXISTS mdm.ref_codelist (
    id          SERIAL PRIMARY KEY,
    domain      VARCHAR(60) NOT NULL,        -- e.g. 'CUSTOMER_TYPE', 'SEGMENT', 'INDUSTRY_CODE'
    code        VARCHAR(60) NOT NULL,
    label       VARCHAR(200) NOT NULL,
    description TEXT,
    metadata    JSONB DEFAULT '{}',          -- extra attributes (icon, color, parent, etc.)
    sort_order  INT NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(domain, code)
);

CREATE INDEX IF NOT EXISTS idx_codelist_domain ON mdm.ref_codelist(domain);

-- Seed: Customer Types
INSERT INTO mdm.ref_codelist (domain, code, label, description, sort_order) VALUES
('CUSTOMER_TYPE', 'PROSPECT',      'Prospect',       'Potential customer not yet active',          10),
('CUSTOMER_TYPE', 'SMB',           'SMB',             'Small and medium business',                  20),
('CUSTOMER_TYPE', 'ENTERPRISE',    'Enterprise',      'Large enterprise account',                   30),
('CUSTOMER_TYPE', 'PUBLIC_SECTOR', 'Public Sector',   'Government or public institution',           40),
('CUSTOMER_TYPE', 'PARTNER',       'Partner',         'Business partner or reseller',               50)
ON CONFLICT (domain, code) DO NOTHING;

-- Seed: Customer Segments
INSERT INTO mdm.ref_codelist (domain, code, label, description, sort_order) VALUES
('SEGMENT', 'OFFICE',       'Office Supplies',    'Traditional office supplies and stationery',  10),
('SEGMENT', 'INDUSTRIAL',   'Industrial',         'Industrial and warehouse supplies',            20),
('SEGMENT', 'HOSPITALITY',  'Hospitality',        'Hotels, restaurants, catering',                30),
('SEGMENT', 'HEALTHCARE',   'Healthcare',         'Hospitals, clinics, medical offices',          40),
('SEGMENT', 'EDUCATION',    'Education',          'Schools, universities, training centers',      50),
('SEGMENT', 'RETAIL',       'Retail',             'Retail stores and chains',                     60)
ON CONFLICT (domain, code) DO NOTHING;

-- Seed: Industry Codes (NACE Rev.2 sections)
INSERT INTO mdm.ref_codelist (domain, code, label, description, sort_order) VALUES
('INDUSTRY_CODE', 'A',  'Agriculture',              'Agriculture, forestry and fishing',               10),
('INDUSTRY_CODE', 'C',  'Manufacturing',            'Manufacturing',                                   20),
('INDUSTRY_CODE', 'F',  'Construction',             'Construction',                                    30),
('INDUSTRY_CODE', 'G',  'Wholesale & Retail',       'Wholesale and retail trade',                      40),
('INDUSTRY_CODE', 'H',  'Transport & Storage',      'Transportation and storage',                      50),
('INDUSTRY_CODE', 'I',  'Accommodation & Food',     'Accommodation and food service activities',       60),
('INDUSTRY_CODE', 'J',  'IT & Communication',       'Information and communication',                   70),
('INDUSTRY_CODE', 'K',  'Finance & Insurance',      'Financial and insurance activities',              80),
('INDUSTRY_CODE', 'M',  'Professional Services',    'Professional, scientific and technical',          90),
('INDUSTRY_CODE', 'N',  'Admin & Support',          'Administrative and support service activities',  100),
('INDUSTRY_CODE', 'P',  'Education',                'Education',                                      110),
('INDUSTRY_CODE', 'Q',  'Health & Social',          'Human health and social work activities',        120),
('INDUSTRY_CODE', 'S',  'Other Services',           'Other service activities',                       130)
ON CONFLICT (domain, code) DO NOTHING;

-- Seed: Product Types
INSERT INTO mdm.ref_codelist (domain, code, label, description, sort_order) VALUES
('PRODUCT_TYPE', 'STANDARD', 'Standard',   'Standard catalog product',      10),
('PRODUCT_TYPE', 'SERVICE',  'Service',    'Service or subscription',       20),
('PRODUCT_TYPE', 'BUNDLE',   'Bundle',     'Product bundle or kit',         30),
('PRODUCT_TYPE', 'CUSTOM',   'Custom',     'Custom or made-to-order item',  40)
ON CONFLICT (domain, code) DO NOTHING;

-- Seed: Units of Measure (codes match product records)
INSERT INTO mdm.ref_codelist (domain, code, label, description, sort_order) VALUES
('UNIT_OF_MEASURE', 'EACH',   'Each',       'Individual unit',       10),
('UNIT_OF_MEASURE', 'PACK',   'Pack',       'Pack / package',        20),
('UNIT_OF_MEASURE', 'BOX',    'Box',        'Box',                   30),
('UNIT_OF_MEASURE', 'SET',    'Set',        'Set / kit',             40),
('UNIT_OF_MEASURE', 'REAM',   'Ream',       'Ream (500 sheets)',     50),
('UNIT_OF_MEASURE', 'ROLL',   'Roll',       'Roll',                  60),
('UNIT_OF_MEASURE', 'BOTTLE', 'Bottle',     'Bottle',                70),
('UNIT_OF_MEASURE', 'CASE',   'Case',       'Case',                  80),
('UNIT_OF_MEASURE', 'KG',     'Kilogram',   'Kilogram',              90),
('UNIT_OF_MEASURE', 'LITER',  'Liter',      'Liter',                100)
ON CONFLICT (domain, code) DO NOTHING;

-- Seed: ESG Ratings (codes match product records: A+, A, B, C, D)
INSERT INTO mdm.ref_codelist (domain, code, label, description, sort_order, metadata) VALUES
('ESG_RATING', 'A+',  'A+ — Excellent',      'Best-in-class ESG performance',        10, '{"color":"#2E7D32"}'),
('ESG_RATING', 'A',   'A — Good',            'Strong ESG performance',               20, '{"color":"#66BB6A"}'),
('ESG_RATING', 'B',   'B — Average',         'Average ESG performance',              30, '{"color":"#FFA726"}'),
('ESG_RATING', 'C',   'C — Below Average',   'Below average ESG performance',        40, '{"color":"#FF7043"}'),
('ESG_RATING', 'D',   'D — Poor',            'Poor ESG performance',                 50, '{"color":"#EF5350"}')
ON CONFLICT (domain, code) DO NOTHING;

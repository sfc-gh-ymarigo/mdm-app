-- ============================================================
-- MDM Demo - Reference Data (shared across all customers)
-- ============================================================

SET search_path TO mdm, public;

-- Reference: Countries
INSERT INTO mdm.ref_country (code, name, region) VALUES
('FRA', 'France', 'Western Europe'),
('GBR', 'United Kingdom', 'Western Europe'),
('DEU', 'Germany', 'Western Europe'),
('NLD', 'Netherlands', 'Western Europe'),
('BEL', 'Belgium', 'Western Europe'),
('ITA', 'Italy', 'Southern Europe'),
('ESP', 'Spain', 'Southern Europe'),
('POL', 'Poland', 'Eastern Europe'),
('CZE', 'Czech Republic', 'Eastern Europe'),
('SVK', 'Slovakia', 'Eastern Europe'),
('SWE', 'Sweden', 'Northern Europe'),
('NOR', 'Norway', 'Northern Europe'),
('DNK', 'Denmark', 'Northern Europe'),
('IRL', 'Ireland', 'Western Europe'),
('CHE', 'Switzerland', 'Western Europe'),
('AUS', 'Australia', 'Asia-Pacific'),
('KOR', 'South Korea', 'Asia-Pacific'),
('USA', 'United States', 'North America'),
('CAN', 'Canada', 'North America'),
('BRA', 'Brazil', 'South America')
ON CONFLICT (code) DO NOTHING;

-- Reference: Languages
INSERT INTO mdm.ref_language (code, name) VALUES
('fr', 'French'), ('en', 'English'), ('de', 'German'),
('nl', 'Dutch'), ('it', 'Italian'), ('es', 'Spanish'),
('pl', 'Polish'), ('cs', 'Czech'), ('sk', 'Slovak'),
('sv', 'Swedish'), ('no', 'Norwegian'), ('da', 'Danish'),
('pt', 'Portuguese'), ('ko', 'Korean')
ON CONFLICT (code) DO NOTHING;

-- Reference: Currencies
INSERT INTO mdm.ref_currency (code, name, symbol) VALUES
('EUR', 'Euro', '€'), ('GBP', 'British Pound', '£'),
('SEK', 'Swedish Krona', 'kr'), ('NOK', 'Norwegian Krone', 'kr'),
('DKK', 'Danish Krone', 'kr'), ('PLN', 'Polish Zloty', 'zł'),
('CZK', 'Czech Koruna', 'Kč'), ('CHF', 'Swiss Franc', 'CHF'),
('USD', 'US Dollar', '$'), ('AUD', 'Australian Dollar', 'A$'),
('KRW', 'South Korean Won', '₩'), ('BRL', 'Brazilian Real', 'R$'),
('CAD', 'Canadian Dollar', 'C$')
ON CONFLICT (code) DO NOTHING;

-- Reference: Lifecycle stages
INSERT INTO mdm.ref_lifecycle_stage (entity_type, stage_code, stage_label, sort_order, is_terminal) VALUES
('CUSTOMER', 'DRAFT',     'Draft',             10, FALSE),
('CUSTOMER', 'REVIEW',    'Under Review',      20, FALSE),
('CUSTOMER', 'VALIDATED', 'Validated',          30, FALSE),
('CUSTOMER', 'ACTIVE',    'Active',             40, FALSE),
('CUSTOMER', 'SUSPENDED', 'Suspended',          50, FALSE),
('CUSTOMER', 'ARCHIVED',  'Archived',           60, TRUE),
('PRODUCT',  'DRAFT',     'Draft',              10, FALSE),
('PRODUCT',  'ENRICHMENT','Enrichment',         20, FALSE),
('PRODUCT',  'REVIEW',    'Under Review',       30, FALSE),
('PRODUCT',  'APPROVED',  'Approved',           40, FALSE),
('PRODUCT',  'PUBLISHED', 'Published',          50, FALSE),
('PRODUCT',  'DISCONTINUED','Discontinued',     60, TRUE)
ON CONFLICT (entity_type, stage_code) DO NOTHING;

-- Reference: Transitions
INSERT INTO mdm.ref_lifecycle_transition (entity_type, from_stage_code, to_stage_code, required_role) VALUES
('CUSTOMER', 'DRAFT',     'REVIEW',    'DATA_STEWARD'),
('CUSTOMER', 'REVIEW',    'VALIDATED', 'DATA_STEWARD'),
('CUSTOMER', 'REVIEW',    'DRAFT',     'DATA_STEWARD'),
('CUSTOMER', 'VALIDATED', 'ACTIVE',    'DATA_MANAGER'),
('CUSTOMER', 'ACTIVE',    'SUSPENDED', 'DATA_MANAGER'),
('CUSTOMER', 'SUSPENDED', 'ACTIVE',    'DATA_MANAGER'),
('CUSTOMER', 'ACTIVE',    'ARCHIVED',  'DATA_MANAGER'),
('PRODUCT',  'DRAFT',     'ENRICHMENT','DATA_STEWARD'),
('PRODUCT',  'ENRICHMENT','REVIEW',    'DATA_STEWARD'),
('PRODUCT',  'REVIEW',    'APPROVED',  'PRODUCT_MANAGER'),
('PRODUCT',  'REVIEW',    'ENRICHMENT','PRODUCT_MANAGER'),
('PRODUCT',  'APPROVED',  'PUBLISHED', 'DATA_MANAGER'),
('PRODUCT',  'PUBLISHED', 'DISCONTINUED','DATA_MANAGER')
ON CONFLICT (entity_type, from_stage_code, to_stage_code) DO NOTHING;

-- Dynamic attribute definitions
INSERT INTO mdm.attribute_definition (entity_type, attribute_key, display_label, data_type, is_mandatory, category, sort_order) VALUES
('CUSTOMER', 'payment_terms',     'Payment Terms',       'LOV',     TRUE,  NULL, 10),
('CUSTOMER', 'credit_limit',      'Credit Limit (EUR)',  'NUMBER',  FALSE, NULL, 20),
('CUSTOMER', 'delivery_preference','Delivery Preference','LOV',     FALSE, NULL, 30),
('CUSTOMER', 'account_manager',   'Account Manager',     'TEXT',    FALSE, NULL, 40),
('PRODUCT',  'recycled_content',  'Recycled Content %',  'NUMBER',  FALSE, NULL, 10),
('PRODUCT',  'fsc_certified',     'FSC Certified',       'BOOLEAN', FALSE, 'OFF', 20),
('PRODUCT',  'energy_rating',     'Energy Rating',       'LOV',     FALSE, 'TECH', 30),
('PRODUCT',  'ergonomic_certified','Ergonomic Certified','BOOLEAN', FALSE, 'FURN', 40),
('PRODUCT',  'chemical_class',    'Chemical Class',      'LOV',     FALSE, 'HYG',  50),
('PRODUCT',  'shelf_life_days',   'Shelf Life (days)',   'NUMBER',  FALSE, NULL, 60)
ON CONFLICT (entity_type, attribute_key) DO NOTHING;

-- LOV values
UPDATE mdm.attribute_definition SET lov_values = '["Net 30","Net 60","Net 90","Prepaid"]' WHERE attribute_key = 'payment_terms';
UPDATE mdm.attribute_definition SET lov_values = '["Standard","Express","Scheduled","Click&Collect"]' WHERE attribute_key = 'delivery_preference';
UPDATE mdm.attribute_definition SET lov_values = '["A+++","A++","A+","A","B","C","D"]' WHERE attribute_key = 'energy_rating';
UPDATE mdm.attribute_definition SET lov_values = '["Non-hazardous","Irritant","Corrosive","Toxic"]' WHERE attribute_key = 'chemical_class';

-- ============================================================
-- MDM - Seed Data for Demo
-- ============================================================

SET search_path TO mdm, public;

-- Reference: Countries (Acme markets)
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
('BRA', 'Brazil', 'South America');

-- Reference: Languages
INSERT INTO mdm.ref_language (code, name) VALUES
('fr', 'French'), ('en', 'English'), ('de', 'German'),
('nl', 'Dutch'), ('it', 'Italian'), ('es', 'Spanish'),
('pl', 'Polish'), ('cs', 'Czech'), ('sk', 'Slovak'),
('sv', 'Swedish'), ('no', 'Norwegian'), ('da', 'Danish'),
('pt', 'Portuguese'), ('ko', 'Korean');

-- Reference: Currencies
INSERT INTO mdm.ref_currency (code, name, symbol) VALUES
('EUR', 'Euro', '€'), ('GBP', 'British Pound', '£'),
('SEK', 'Swedish Krona', 'kr'), ('NOK', 'Norwegian Krone', 'kr'),
('DKK', 'Danish Krone', 'kr'), ('PLN', 'Polish Zloty', 'zł'),
('CZK', 'Czech Koruna', 'Kč'), ('CHF', 'Swiss Franc', 'CHF'),
('USD', 'US Dollar', '$'), ('AUD', 'Australian Dollar', 'A$'),
('KRW', 'South Korean Won', '₩'), ('BRL', 'Brazilian Real', 'R$'),
('CAD', 'Canadian Dollar', 'C$');

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
('PRODUCT',  'DISCONTINUED','Discontinued',     60, TRUE);

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
('PRODUCT',  'PUBLISHED', 'DISCONTINUED','DATA_MANAGER');

-- Product categories (Acme catalog structure)
INSERT INTO mdm.product_category (code, name, level) VALUES
('OFF',  'Office Supplies',       0),
('TECH', 'Technology',            0),
('FURN', 'Furniture',             0),
('PPE',  'Personal Protection',   0),
('HYG',  'Hygiene & Cleaning',    0),
('PKG',  'Packaging',             0);

INSERT INTO mdm.product_category (code, name, parent_id, level) VALUES
('OFF_PAPER',  'Paper & Notebooks',     (SELECT id FROM mdm.product_category WHERE code='OFF'), 1),
('OFF_WRITE',  'Writing Instruments',   (SELECT id FROM mdm.product_category WHERE code='OFF'), 1),
('OFF_FILE',   'Filing & Organization', (SELECT id FROM mdm.product_category WHERE code='OFF'), 1),
('TECH_PRINT', 'Printers & Cartridges', (SELECT id FROM mdm.product_category WHERE code='TECH'), 1),
('TECH_ACC',   'IT Accessories',        (SELECT id FROM mdm.product_category WHERE code='TECH'), 1),
('FURN_DESK',  'Desks & Tables',        (SELECT id FROM mdm.product_category WHERE code='FURN'), 1),
('FURN_CHAIR', 'Ergonomic Chairs',      (SELECT id FROM mdm.product_category WHERE code='FURN'), 1),
('PPE_GLOVE',  'Protective Gloves',     (SELECT id FROM mdm.product_category WHERE code='PPE'), 1),
('PPE_MASK',   'Safety Masks',          (SELECT id FROM mdm.product_category WHERE code='PPE'), 1),
('HYG_TISSUE', 'Tissues & Towels',      (SELECT id FROM mdm.product_category WHERE code='HYG'), 1),
('HYG_SOAP',   'Soaps & Sanitizers',    (SELECT id FROM mdm.product_category WHERE code='HYG'), 1),
('PKG_BOX',    'Shipping Boxes',        (SELECT id FROM mdm.product_category WHERE code='PKG'), 1),
('PKG_TAPE',   'Adhesive Tapes',        (SELECT id FROM mdm.product_category WHERE code='PKG'), 1);

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
('PRODUCT',  'shelf_life_days',   'Shelf Life (days)',   'NUMBER',  FALSE, NULL, 60);

-- LOV values
UPDATE mdm.attribute_definition SET lov_values = '["Net 30","Net 60","Net 90","Prepaid"]' WHERE attribute_key = 'payment_terms';
UPDATE mdm.attribute_definition SET lov_values = '["Standard","Express","Scheduled","Click&Collect"]' WHERE attribute_key = 'delivery_preference';
UPDATE mdm.attribute_definition SET lov_values = '["A+++","A++","A+","A","B","C","D"]' WHERE attribute_key = 'energy_rating';
UPDATE mdm.attribute_definition SET lov_values = '["Non-hazardous","Irritant","Corrosive","Toxic"]' WHERE attribute_key = 'chemical_class';

-- ============================================================
-- CUSTOMERS (Acme B2B customers)
-- ============================================================

INSERT INTO mdm.customer (id, source_system, source_id, lifecycle_stage, legal_name, trade_name, tax_id, duns_number, siren, siret, address_line1, city, postal_code, country_code, phone, email, website, customer_type, segment, industry_code, dq_score, completeness, extended_attrs) VALUES

-- Group account: Renault
('a0000001-0001-4000-8000-000000000001', 'SAP_FR', 'CUST-FR-001', 'ACTIVE',
 'Renault Group SA', 'Renault', 'FR78780129987', '210567834', '780129987', '78012998700015',
 '13 Quai Alphonse le Gallo', 'Boulogne-Billancourt', '92100', 'FRA',
 '+33 1 76 84 04 04', 'procurement@renault.com', 'https://www.renault.com',
 'ENTERPRISE', 'INDUSTRIAL', 'C29', 95.50, 91.67,
 '{"payment_terms": "Net 60", "credit_limit": 500000, "account_manager": "Sophie Martin"}'),

-- Renault child: UK
('a0000001-0001-4000-8000-000000000002', 'SAP_UK', 'CUST-UK-001', 'ACTIVE',
 'Renault UK Ltd', 'Renault UK', 'GB123456789', '215678901', NULL, NULL,
 'The Rivers Office Park', 'Rickmansworth', 'WD3 1RE', 'GBR',
 '+44 1923 899999', 'purchasing@renault.co.uk', 'https://www.renault.co.uk',
 'ENTERPRISE', 'INDUSTRIAL', 'C29', 82.30, 75.00,
 '{"payment_terms": "Net 30", "delivery_preference": "Standard"}'),

-- BNP Paribas
('a0000001-0001-4000-8000-000000000003', 'SAP_FR', 'CUST-FR-002', 'ACTIVE',
 'BNP Paribas SA', 'BNP Paribas', 'FR76662042449', '200456789', '662042449', '66204244900014',
 '16 Boulevard des Italiens', 'Paris', '75009', 'FRA',
 '+33 1 40 14 45 46', 'supplier.mgmt@bnpparibas.com', 'https://www.bnpparibas.com',
 'ENTERPRISE', 'OFFICE', 'K64', 98.00, 100.00,
 '{"payment_terms": "Net 30", "credit_limit": 750000, "account_manager": "Jean Dupont"}'),

-- SNCF
('a0000001-0001-4000-8000-000000000004', 'SAP_FR', 'CUST-FR-003', 'VALIDATED',
 'SNCF Voyageurs SA', 'SNCF', 'FR81519037584', '220987654', '519037584', '51903758400019',
 '2 Place aux Étoiles', 'Saint-Denis', '93200', 'FRA',
 '+33 1 85 07 89 89', 'achats@sncf.fr', 'https://www.sncf.com',
 'ENTERPRISE', 'INDUSTRIAL', 'H49', 88.75, 83.33,
 '{"payment_terms": "Net 60", "delivery_preference": "Scheduled"}'),

-- Siemens DE
('a0000001-0001-4000-8000-000000000005', 'SAP_DE', 'CUST-DE-001', 'ACTIVE',
 'Siemens AG', 'Siemens', 'DE811185832', '312456789', NULL, NULL,
 'Werner-von-Siemens-Straße 1', 'München', '80333', 'DEU',
 '+49 89 636 00', 'procurement@siemens.com', 'https://www.siemens.com',
 'ENTERPRISE', 'INDUSTRIAL', 'C27', 92.00, 83.33,
 '{"payment_terms": "Net 30", "credit_limit": 300000, "account_manager": "Klaus Weber"}'),

-- SMB example
('a0000001-0001-4000-8000-000000000006', 'WEB_FR', 'CUST-FR-004', 'DRAFT',
 'Cabinet Moreau & Associés', NULL, 'FR12345678901', NULL, NULL, NULL,
 '42 Rue de la Paix', 'Lyon', '69002', 'FRA',
 '+33 4 72 00 00 00', 'info@moreau-associes.fr', NULL,
 'SMB', 'OFFICE', 'M69', 45.00, 50.00,
 '{"payment_terms": "Prepaid"}'),

-- Prospect
('a0000001-0001-4000-8000-000000000007', 'CRM_UK', 'LEAD-UK-099', 'DRAFT',
 'Greggs PLC', 'Greggs', 'GB987654321', NULL, NULL, NULL,
 'Greggs House, Quorum Business Park', 'Newcastle upon Tyne', 'NE12 8BU', 'GBR',
 '+44 191 281 7721', NULL, 'https://www.greggs.co.uk',
 'PROSPECT', 'HOSPITALITY', 'I56', 35.00, 41.67,
 '{}'),

-- Public sector
('a0000001-0001-4000-8000-000000000008', 'SAP_NL', 'CUST-NL-001', 'REVIEW',
 'Gemeente Amsterdam', 'City of Amsterdam', 'NL002564440B01', '412345678', NULL, NULL,
 'Amstel 1', 'Amsterdam', '1011 PN', 'NLD',
 '+31 20 624 1111', 'inkoop@amsterdam.nl', 'https://www.amsterdam.nl',
 'PUBLIC_SECTOR', 'OFFICE', 'O84', 72.50, 66.67,
 '{"payment_terms": "Net 90", "delivery_preference": "Scheduled"}'),

-- Duplicate candidate (fuzzy match for BNP)
('a0000001-0001-4000-8000-000000000009', 'LEGACY_BE', 'CUST-BE-101', 'REVIEW',
 'BNP Paribas Fortis NV', 'BNP Paribas Fortis', 'BE0403199702', '200456999', NULL, NULL,
 'Warandeberg 3', 'Brussels', '1000', 'BEL',
 '+32 2 565 11 11', 'procurement@bnpparibasfortis.be', 'https://www.bnpparibasfortis.be',
 'ENTERPRISE', 'OFFICE', 'K64', 78.00, 75.00,
 '{"payment_terms": "Net 30"}'),

-- Poland
('a0000001-0001-4000-8000-000000000010', 'SAP_PL', 'CUST-PL-001', 'ACTIVE',
 'PKN Orlen SA', 'Orlen', 'PL7740001454', '510987654', NULL, NULL,
 'ul. Chemików 7', 'Płock', '09-411', 'POL',
 '+48 24 256 00 00', 'biuro@orlen.pl', 'https://www.orlen.pl',
 'ENTERPRISE', 'INDUSTRIAL', 'C19', 87.00, 75.00,
 '{"payment_terms": "Net 30", "credit_limit": 200000}');

-- Set parent for Renault UK
UPDATE mdm.customer SET parent_id = 'a0000001-0001-4000-8000-000000000001'
WHERE id = 'a0000001-0001-4000-8000-000000000002';

-- ============================================================
-- PRODUCTS (Acme catalog items)
-- ============================================================

-- Use DO block to resolve category IDs dynamically
DO $$
DECLARE
  v_off_paper INT; v_off_write INT; v_tech_print INT; v_tech_acc INT;
  v_furn_chair INT; v_ppe_glove INT; v_hyg_tissue INT; v_hyg_soap INT;
BEGIN
  SELECT id INTO v_off_paper FROM mdm.product_category WHERE code='OFF_PAPER';
  SELECT id INTO v_off_write FROM mdm.product_category WHERE code='OFF_WRITE';
  SELECT id INTO v_tech_print FROM mdm.product_category WHERE code='TECH_PRINT';
  SELECT id INTO v_tech_acc FROM mdm.product_category WHERE code='TECH_ACC';
  SELECT id INTO v_furn_chair FROM mdm.product_category WHERE code='FURN_CHAIR';
  SELECT id INTO v_ppe_glove FROM mdm.product_category WHERE code='PPE_GLOVE';
  SELECT id INTO v_hyg_tissue FROM mdm.product_category WHERE code='HYG_TISSUE';
  SELECT id INTO v_hyg_soap FROM mdm.product_category WHERE code='HYG_SOAP';

  INSERT INTO mdm.product (id, source_system, source_id, lifecycle_stage, sku, ean, name, short_desc, long_desc, brand, manufacturer, category_id, product_type, unit_of_measure, weight_kg, list_price, currency_code, hazardous, esg_rating, dq_score, completeness, extended_attrs, translations) VALUES
  ('b0000001-0001-4000-8000-000000000001', 'PIM_FR', 'PROD-001', 'PUBLISHED',
   'ACM-PAP-A4-80', '3660141001013', 'Acme Premium A4 Copy Paper 80gsm', 'High-quality A4 paper, 80g/m², 500 sheets',
   'Premium white copy paper, 80g/m² density. Suitable for all office printers and copiers. FSC certified. ColorLok technology for vivid colours.',
   'Acme', 'Acme SAS', v_off_paper, 'STANDARD', 'REAM', 2.500, 4.99, 'EUR', FALSE, 'A',
   96.00, 100.00,
   '{"recycled_content": 0, "fsc_certified": true}',
   '{"fr": {"name": "Papier Acme Premium A4 80g", "short_desc": "Papier A4 haute qualité, 80g/m², 500 feuilles"}, "de": {"name": "Acme Premium A4 Kopierpapier 80g", "short_desc": "Hochwertiges A4-Papier, 80g/m², 500 Blatt"}}'),
  ('b0000001-0001-4000-8000-000000000002', 'PIM_FR', 'PROD-002', 'PUBLISHED',
   'ACM-PAP-A4-REC', '3660141001020', 'Acme Recycled A4 Paper 80gsm', 'Recycled A4 paper, 80g/m², 500 sheets',
   '100% recycled white copy paper. Blue Angel and EU Ecolabel certified. Compatible with all standard office equipment.',
   'Acme', 'Acme SAS', v_off_paper, 'STANDARD', 'REAM', 2.500, 5.49, 'EUR', FALSE, 'A+',
   94.00, 100.00,
   '{"recycled_content": 100, "fsc_certified": true}',
   '{"fr": {"name": "Papier recyclé Acme A4 80g", "short_desc": "Papier recyclé A4, 80g/m², 500 feuilles"}}'),
  ('b0000001-0001-4000-8000-000000000003', 'PIM_FR', 'PROD-003', 'PUBLISHED',
   'PIL-G2-07-BLK', '4902505163111', 'Pilot G2 Gel Pen 0.7mm Black', 'Retractable gel ink pen, black, medium point',
   'Pilot G2 retractable gel ink rollerball pen. Smooth writing experience with quick-drying gel ink. Refillable. Comfortable rubber grip.',
   'Pilot', 'Pilot Corporation', v_off_write, 'STANDARD', 'EACH', 0.015, 3.29, 'EUR', FALSE, 'B',
   92.00, 90.00,
   '{"recycled_content": 0}',
   '{"fr": {"name": "Stylo gel Pilot G2 0.7mm noir"}}'),
  ('b0000001-0001-4000-8000-000000000004', 'PIM_FR', 'PROD-004', 'APPROVED',
   'HP-LJ-M404DN', '0192018902268', 'HP LaserJet Pro M404dn Mono Printer', 'Professional mono laser printer with duplex',
   'HP LaserJet Pro M404dn. Print speed up to 38 ppm. Automatic duplex printing. Gigabit Ethernet. 256 MB memory. Energy Star certified.',
   'HP', 'HP Inc.', v_tech_print, 'STANDARD', 'EACH', 10.200, 329.00, 'EUR', FALSE, 'B',
   88.00, 90.00,
   '{"energy_rating": "A+"}',
   '{}'),
  ('b0000001-0001-4000-8000-000000000005', 'PIM_FR', 'PROD-005', 'PUBLISHED',
   'LOG-MK270-WL', '5099206039599', 'Logitech MK270 Wireless Keyboard & Mouse', 'Wireless desktop keyboard and mouse combo',
   'Logitech MK270 wireless combo. Full-size keyboard with numpad. Ambidextrous optical mouse. 2.4 GHz wireless. Up to 24-month battery life.',
   'Logitech', 'Logitech Europe SA', v_tech_acc, 'STANDARD', 'SET', 0.750, 34.99, 'EUR', FALSE, 'B',
   90.00, 90.00,
   '{"energy_rating": "A"}',
   '{"fr": {"name": "Clavier et souris sans fil Logitech MK270"}}'),
  ('b0000001-0001-4000-8000-000000000006', 'PIM_FR', 'PROD-006', 'ENRICHMENT',
   'SIT-LN-ERGO', NULL, 'SitOnIt Novo Ergonomic Task Chair', 'Ergonomic office chair with lumbar support',
   'SitOnIt Novo high-back task chair. Adjustable lumbar support, 4D armrests. Synchro-tilt mechanism. Certified by BIFMA. Weight capacity 130 kg.',
   'SitOnIt Seating', 'Exemplis Corporation', v_furn_chair, 'STANDARD', 'EACH', 18.500, 649.00, 'EUR', FALSE, 'A',
   65.00, 70.00,
   '{"ergonomic_certified": true}',
   '{}'),
  ('b0000001-0001-4000-8000-000000000007', 'PIM_FR', 'PROD-007', 'PUBLISHED',
   'ANS-TOUCHNTUF', '0076490926327', 'Ansell TouchNTuff 92-600 Nitrile Gloves Box/100', 'Disposable nitrile examination gloves',
   'Ansell TouchNTuff 92-600. Chemical splash resistance. Textured fingertips. Powder-free. 0.12mm thickness. EN 374 certified.',
   'Ansell', 'Ansell Limited', v_ppe_glove, 'STANDARD', 'BOX', 0.800, 18.90, 'EUR', FALSE, NULL,
   85.00, 80.00,
   '{"chemical_class": "Non-hazardous"}',
   '{"fr": {"name": "Gants nitrile Ansell TouchNTuff 92-600 boîte/100"}}'),
  ('b0000001-0001-4000-8000-000000000008', 'PIM_FR', 'PROD-008', 'DRAFT',
   NULL, NULL, 'Tork Premium Hand Towel Roll H1', 'Premium paper hand towel roll for system H1',
   NULL,
   'Tork', 'Essity AB', v_hyg_tissue, 'STANDARD', 'ROLL', 1.200, 45.90, 'EUR', FALSE, NULL,
   42.00, 50.00,
   '{}',
   '{}'),
  ('b0000001-0001-4000-8000-000000000009', 'PIM_FR', 'PROD-009', 'PUBLISHED',
   'DETT-HAND-500', '5011417561539', 'Dettol Antibacterial Hand Wash 500ml', 'Liquid hand wash, original fragrance',
   'Dettol antibacterial liquid hand wash. Kills 99.9% of bacteria. Dermatologically tested. pH balanced.',
   'Dettol', 'Reckitt Benckiser', v_hyg_soap, 'STANDARD', 'BOTTLE', 0.550, 4.29, 'EUR', FALSE, 'B',
   90.00, 90.00,
   '{"chemical_class": "Non-hazardous", "shelf_life_days": 730}',
   '{"fr": {"name": "Savon antibactérien Dettol 500ml"}}'),
  ('b0000001-0001-4000-8000-000000000010', 'LEGACY_DE', 'PROD-DE-099', 'REVIEW',
   'ACM-PAP-A4-80G', '3660141001099', 'Acme A4 Copy Paper 80 gsm', 'A4 paper 80gsm 500 sheets ream',
   NULL,
   'Acme', 'Acme SAS', v_off_paper, 'STANDARD', 'REAM', 2.500, 4.89, 'EUR', FALSE, NULL,
   55.00, 60.00,
   '{}',
   '{"de": {"name": "Acme A4 Kopierpapier 80g/m²"}}');
END $$;

-- ============================================================
-- MATCH CANDIDATES (pre-computed for demo)
-- ============================================================

INSERT INTO mdm.match_candidate (entity_type, entity_id_a, entity_id_b, match_score, match_method, match_fields, status) VALUES
('CUSTOMER',
 'a0000001-0001-4000-8000-000000000003',
 'a0000001-0001-4000-8000-000000000009',
 87.50, 'FUZZY',
 '{"legal_name": 0.82, "industry_code": 1.0, "segment": 1.0}',
 'PENDING'),
('PRODUCT',
 'b0000001-0001-4000-8000-000000000001',
 'b0000001-0001-4000-8000-000000000010',
 92.30, 'FUZZY',
 '{"name": 0.89, "brand": 1.0, "manufacturer": 1.0, "category_id": 1.0, "weight_kg": 1.0}',
 'PENDING');

-- ============================================================
-- WORKFLOW INSTANCES
-- ============================================================

INSERT INTO mdm.workflow_instance (entity_type, entity_id, workflow_type, current_stage, assigned_to, assigned_role, priority, created_by) VALUES
('CUSTOMER', 'a0000001-0001-4000-8000-000000000006', 'ONBOARDING', 'REVIEW', 'benoit.declarens@example.com', 'DATA_STEWARD', 'HIGH', 'system'),
('CUSTOMER', 'a0000001-0001-4000-8000-000000000007', 'ONBOARDING', 'DRAFT', 'alice.martin@example.com', 'DATA_STEWARD', 'MEDIUM', 'system'),
('CUSTOMER', 'a0000001-0001-4000-8000-000000000008', 'ONBOARDING', 'REVIEW', 'benoit.declarens@example.com', 'DATA_STEWARD', 'MEDIUM', 'system'),
('PRODUCT', 'b0000001-0001-4000-8000-000000000006', 'ENRICHMENT', 'ENRICHMENT', 'product.team@example.com', 'DATA_STEWARD', 'HIGH', 'system'),
('PRODUCT', 'b0000001-0001-4000-8000-000000000008', 'ONBOARDING', 'DRAFT', 'product.team@example.com', 'DATA_STEWARD', 'LOW', 'system'),
('CUSTOMER', 'a0000001-0001-4000-8000-000000000003', 'MERGE', 'REVIEW', 'benoit.declarens@example.com', 'DATA_MANAGER', 'HIGH', 'system');

-- ============================================================
-- DATA QUALITY RULES
-- ============================================================

INSERT INTO mdm.dq_rule (entity_type, rule_code, rule_name, rule_type, sql_expression, severity) VALUES
('CUSTOMER', 'CUS_COMP_NAME',      'Customer must have legal name',       'COMPLETENESS', 'legal_name IS NOT NULL AND legal_name != ''''', 'ERROR'),
('CUSTOMER', 'CUS_COMP_COUNTRY',   'Customer must have country',          'COMPLETENESS', 'country_code IS NOT NULL', 'ERROR'),
('CUSTOMER', 'CUS_COMP_ADDRESS',   'Customer should have full address',   'COMPLETENESS', 'address_line1 IS NOT NULL AND city IS NOT NULL AND postal_code IS NOT NULL', 'WARNING'),
('CUSTOMER', 'CUS_COMP_CONTACT',   'Customer should have contact info',   'COMPLETENESS', 'email IS NOT NULL OR phone IS NOT NULL', 'WARNING'),
('CUSTOMER', 'CUS_VALID_EMAIL',    'Email format must be valid',          'VALIDITY',     'email IS NULL OR email ~ ''^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$''', 'ERROR'),
('CUSTOMER', 'CUS_VALID_TAXID',    'Active customer must have Tax ID',    'VALIDITY',     'lifecycle_stage != ''ACTIVE'' OR tax_id IS NOT NULL', 'ERROR'),
('CUSTOMER', 'CUS_CONSIST_PARENT', 'Child customer cannot be archived if parent is active', 'CONSISTENCY', 'parent_id IS NULL OR lifecycle_stage != ''ARCHIVED''', 'WARNING'),
('PRODUCT',  'PRD_COMP_SKU',       'Product must have SKU',               'COMPLETENESS', 'sku IS NOT NULL AND sku != ''''', 'ERROR'),
('PRODUCT',  'PRD_COMP_EAN',       'Published product must have EAN',     'COMPLETENESS', 'lifecycle_stage != ''PUBLISHED'' OR ean IS NOT NULL', 'ERROR'),
('PRODUCT',  'PRD_COMP_DESC',      'Product should have description',     'COMPLETENESS', 'short_desc IS NOT NULL', 'WARNING'),
('PRODUCT',  'PRD_COMP_PRICE',     'Product must have price',             'COMPLETENESS', 'list_price IS NOT NULL AND list_price > 0', 'ERROR'),
('PRODUCT',  'PRD_COMP_BRAND',     'Product should have brand',           'COMPLETENESS', 'brand IS NOT NULL', 'WARNING'),
('PRODUCT',  'PRD_VALID_WEIGHT',   'Weight must be positive',             'VALIDITY',     'weight_kg IS NULL OR weight_kg > 0', 'ERROR'),
('PRODUCT',  'PRD_VALID_IMAGE',    'Published product should have image', 'COMPLETENESS', 'lifecycle_stage != ''PUBLISHED'' OR primary_image IS NOT NULL', 'WARNING');

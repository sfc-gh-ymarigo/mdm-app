-- ============================================================
-- MDM — FULL DEMO RESET & SEED
-- Covers: every lifecycle stage, all workflow types & states,
--   DQ rules, match candidates (fuzzy/composite), golden records,
--   hierarchies, translations, ESG, extended attrs, deactivation,
--   audit trail, comments, multi-country, multi-source
-- ============================================================

SET search_path TO mdm, public;

-- ============================================================
-- 1. FULL RESET — clear all transactional data
-- ============================================================
TRUNCATE mdm.entity_comment       CASCADE;
TRUNCATE mdm.dq_result            CASCADE;
TRUNCATE mdm.workflow_step_log    CASCADE;
TRUNCATE mdm.workflow_instance    CASCADE;
TRUNCATE mdm.merge_history        CASCADE;
TRUNCATE mdm.match_candidate      CASCADE;
DELETE FROM mdm.product;
DELETE FROM mdm.customer;
-- After the deletes: their audit triggers write rows that would collide with the restarted sequence
TRUNCATE mdm.audit_log            CASCADE;

-- Reset sequences
ALTER SEQUENCE mdm.workflow_instance_id_seq RESTART WITH 1;
ALTER SEQUENCE mdm.match_candidate_id_seq RESTART WITH 1;
ALTER SEQUENCE mdm.merge_history_id_seq RESTART WITH 1;
ALTER SEQUENCE mdm.workflow_step_log_id_seq RESTART WITH 1;
ALTER SEQUENCE mdm.audit_log_id_seq RESTART WITH 1;
ALTER SEQUENCE mdm.dq_result_id_seq RESTART WITH 1;
ALTER SEQUENCE mdm.entity_comment_id_seq RESTART WITH 1;

-- ============================================================
-- 2. CUSTOMERS — 15 records across all lifecycle stages
-- ============================================================

INSERT INTO mdm.customer (id, source_system, source_id, lifecycle_stage, legal_name, trade_name, tax_id, duns_number, siren, siret, address_line1, city, postal_code, country_code, phone, email, website, customer_type, segment, industry_code, dq_score, completeness, extended_attrs, created_by) VALUES

-- === ACTIVE customers (5) — golden path, fully governed ===
('a0000001-0001-4000-8000-000000000001', 'SAP_FR', 'CUST-FR-001', 'ACTIVE',
 'Renault Group SA', 'Renault', 'FR78780129987', '210567834', '780129987', '78012998700015',
 '13 Quai Alphonse le Gallo', 'Boulogne-Billancourt', '92100', 'FRA',
 '+33 1 76 84 04 04', 'procurement@renault.com', 'https://www.renault.com',
 'ENTERPRISE', 'INDUSTRIAL', 'C29', 95.50, 91.67,
 '{"payment_terms": "Net 60", "credit_limit": 500000, "account_manager": "Sophie Martin"}',
 'system'),

('a0000001-0001-4000-8000-000000000002', 'SAP_UK', 'CUST-UK-001', 'ACTIVE',
 'Renault UK Ltd', 'Renault UK', 'GB123456789', '215678901', NULL, NULL,
 'The Rivers Office Park', 'Rickmansworth', 'WD3 1RE', 'GBR',
 '+44 1923 899999', 'purchasing@renault.co.uk', 'https://www.renault.co.uk',
 'ENTERPRISE', 'INDUSTRIAL', 'C29', 82.30, 75.00,
 '{"payment_terms": "Net 30", "delivery_preference": "Standard"}',
 'system'),

('a0000001-0001-4000-8000-000000000003', 'SAP_FR', 'CUST-FR-002', 'ACTIVE',
 'BNP Paribas SA', 'BNP Paribas', 'FR76662042449', '200456789', '662042449', '66204244900014',
 '16 Boulevard des Italiens', 'Paris', '75009', 'FRA',
 '+33 1 40 14 45 46', 'supplier.mgmt@bnpparibas.com', 'https://www.bnpparibas.com',
 'ENTERPRISE', 'OFFICE', 'K64', 98.00, 100.00,
 '{"payment_terms": "Net 30", "credit_limit": 750000, "account_manager": "Jean Dupont"}',
 'system'),

('a0000001-0001-4000-8000-000000000005', 'SAP_DE', 'CUST-DE-001', 'ACTIVE',
 'Siemens AG', 'Siemens', 'DE811185832', '312456789', NULL, NULL,
 'Werner-von-Siemens-Straße 1', 'München', '80333', 'DEU',
 '+49 89 636 00', 'procurement@siemens.com', 'https://www.siemens.com',
 'ENTERPRISE', 'INDUSTRIAL', 'C27', 92.00, 83.33,
 '{"payment_terms": "Net 30", "credit_limit": 300000, "account_manager": "Klaus Weber"}',
 'system'),

('a0000001-0001-4000-8000-000000000010', 'SAP_PL', 'CUST-PL-001', 'ACTIVE',
 'PKN Orlen SA', 'Orlen', 'PL7740001454', '510987654', NULL, NULL,
 'ul. Chemików 7', 'Płock', '09-411', 'POL',
 '+48 24 256 00 00', 'biuro@orlen.pl', 'https://www.orlen.pl',
 'ENTERPRISE', 'INDUSTRIAL', 'C19', 87.00, 75.00,
 '{"payment_terms": "Net 30", "credit_limit": 200000}',
 'system'),

-- === VALIDATED (1) — waiting for final activation ===
('a0000001-0001-4000-8000-000000000004', 'SAP_FR', 'CUST-FR-003', 'VALIDATED',
 'SNCF Voyageurs SA', 'SNCF', 'FR81519037584', '220987654', '519037584', '51903758400019',
 '2 Place aux Étoiles', 'Saint-Denis', '93200', 'FRA',
 '+33 1 85 07 89 89', 'achats@sncf.fr', 'https://www.sncf.com',
 'ENTERPRISE', 'INDUSTRIAL', 'H49', 88.75, 83.33,
 '{"payment_terms": "Net 60", "delivery_preference": "Scheduled"}',
 'system'),

-- === REVIEW (2) — in-flight governance ===
('a0000001-0001-4000-8000-000000000008', 'SAP_NL', 'CUST-NL-001', 'REVIEW',
 'Gemeente Amsterdam', 'City of Amsterdam', 'NL002564440B01', '412345678', NULL, NULL,
 'Amstel 1', 'Amsterdam', '1011 PN', 'NLD',
 '+31 20 624 1111', 'inkoop@amsterdam.nl', 'https://www.amsterdam.nl',
 'PUBLIC_SECTOR', 'OFFICE', 'O84', 72.50, 66.67,
 '{"payment_terms": "Net 90", "delivery_preference": "Scheduled"}',
 'system'),

('a0000001-0001-4000-8000-000000000009', 'LEGACY_BE', 'CUST-BE-101', 'REVIEW',
 'BNP Paribas Fortis NV', 'BNP Paribas Fortis', 'BE0403199702', '200456999', NULL, NULL,
 'Warandeberg 3', 'Brussels', '1000', 'BEL',
 '+32 2 565 11 11', 'procurement@bnpparibasfortis.be', 'https://www.bnpparibasfortis.be',
 'ENTERPRISE', 'OFFICE', 'K64', 78.00, 75.00,
 '{"payment_terms": "Net 30"}',
 'system'),

-- === DRAFT (3) — new entities, low DQ, incomplete data ===
('a0000001-0001-4000-8000-000000000006', 'WEB_FR', 'CUST-FR-004', 'DRAFT',
 'Cabinet Moreau & Associés', NULL, 'FR12345678901', NULL, NULL, NULL,
 '42 Rue de la Paix', 'Lyon', '69002', 'FRA',
 '+33 4 72 00 00 00', 'info@moreau-associes.fr', NULL,
 'SMB', 'OFFICE', 'M69', 45.00, 50.00,
 '{"payment_terms": "Prepaid"}',
 'system'),

('a0000001-0001-4000-8000-000000000007', 'CRM_UK', 'LEAD-UK-099', 'DRAFT',
 'Greggs PLC', 'Greggs', 'GB987654321', NULL, NULL, NULL,
 'Greggs House, Quorum Business Park', 'Newcastle upon Tyne', 'NE12 8BU', 'GBR',
 '+44 191 281 7721', NULL, 'https://www.greggs.co.uk',
 'PROSPECT', 'HOSPITALITY', 'I56', 35.00, 41.67,
 '{}',
 'system'),

('a0000001-0001-4000-8000-000000000011', 'WEB_ES', 'CUST-ES-001', 'DRAFT',
 'Telefónica SA', NULL, NULL, NULL, NULL, NULL,
 'Distrito Telefónica', 'Madrid', '28050', 'ESP',
 '+34 900 111 004', NULL, NULL,
 'ENTERPRISE', 'INDUSTRIAL', 'J61', 25.00, 33.33,
 '{}',
 'system'),

-- === SUSPENDED (1) — frozen account pending review ===
('a0000001-0001-4000-8000-000000000012', 'SAP_IT', 'CUST-IT-001', 'SUSPENDED',
 'Fiat Chrysler Automobiles NV', 'Stellantis Italy', 'IT00469580013', '320987654', NULL, NULL,
 'Corso Giovanni Agnelli 200', 'Torino', '10135', 'ITA',
 '+39 011 003 1111', 'acquisti@stellantis.com', 'https://www.stellantis.com',
 'ENTERPRISE', 'INDUSTRIAL', 'C29', 80.00, 75.00,
 '{"payment_terms": "Net 60", "credit_limit": 400000}',
 'system'),

-- === ARCHIVED (2) — deactivated, shown greyed out ===
('a0000001-0001-4000-8000-000000000013', 'SAP_FR', 'CUST-FR-005', 'ARCHIVED',
 'Alcatel-Lucent SA', 'Alcatel', 'FR54509230055', '190876543', '509230055', NULL,
 '148 Route de la Reine', 'Boulogne-Billancourt', '92100', 'FRA',
 '+33 1 55 14 10 10', 'procurement@alcatel-lucent.com', NULL,
 'ENTERPRISE', 'INDUSTRIAL', 'C26', 60.00, 58.33,
 '{"payment_terms": "Net 30"}',
 'system'),

('a0000001-0001-4000-8000-000000000014', 'LEGACY_UK', 'CUST-UK-OLD', 'ARCHIVED',
 'Thomas Cook Group PLC', 'Thomas Cook', 'GB574389247', NULL, NULL, NULL,
 'Westpoint, Peterborough Business Park', 'Peterborough', 'PE2 6FZ', 'GBR',
 NULL, NULL, NULL,
 'ENTERPRISE', 'HOSPITALITY', 'N79', 30.00, 25.00,
 '{}',
 'system');

-- Set parent-child relationships (hierarchy demo)
UPDATE mdm.customer SET parent_id = 'a0000001-0001-4000-8000-000000000001'
WHERE id = 'a0000001-0001-4000-8000-000000000002';

-- ============================================================
-- 3. PRODUCTS — 15 records across all lifecycle stages
-- ============================================================

DO $$
DECLARE
  v_off_paper INT; v_off_write INT; v_off_file INT;
  v_tech_print INT; v_tech_acc INT;
  v_furn_chair INT; v_furn_desk INT;
  v_ppe_glove INT; v_ppe_mask INT;
  v_hyg_tissue INT; v_hyg_soap INT;
  v_pkg_box INT; v_pkg_tape INT;
BEGIN
  SELECT id INTO v_off_paper FROM mdm.product_category WHERE code='OFF_PAPER';
  SELECT id INTO v_off_write FROM mdm.product_category WHERE code='OFF_WRITE';
  SELECT id INTO v_off_file  FROM mdm.product_category WHERE code='OFF_FILE';
  SELECT id INTO v_tech_print FROM mdm.product_category WHERE code='TECH_PRINT';
  SELECT id INTO v_tech_acc FROM mdm.product_category WHERE code='TECH_ACC';
  SELECT id INTO v_furn_chair FROM mdm.product_category WHERE code='FURN_CHAIR';
  SELECT id INTO v_furn_desk  FROM mdm.product_category WHERE code='FURN_DESK';
  SELECT id INTO v_ppe_glove FROM mdm.product_category WHERE code='PPE_GLOVE';
  SELECT id INTO v_ppe_mask  FROM mdm.product_category WHERE code='PPE_MASK';
  SELECT id INTO v_hyg_tissue FROM mdm.product_category WHERE code='HYG_TISSUE';
  SELECT id INTO v_hyg_soap FROM mdm.product_category WHERE code='HYG_SOAP';
  SELECT id INTO v_pkg_box  FROM mdm.product_category WHERE code='PKG_BOX';
  SELECT id INTO v_pkg_tape FROM mdm.product_category WHERE code='PKG_TAPE';

  INSERT INTO mdm.product (id, source_system, source_id, lifecycle_stage, sku, ean, name, short_desc, long_desc, brand, manufacturer, category_id, product_type, unit_of_measure, weight_kg, length_cm, width_cm, height_cm, list_price, currency_code, hazardous, esg_rating, certifications, dq_score, completeness, extended_attrs, translations, created_by) VALUES

  -- === PUBLISHED (6) — live catalog items ===
  ('b0000001-0001-4000-8000-000000000001', 'PIM_FR', 'PROD-001', 'PUBLISHED',
   'ACM-PAP-A4-80', '3660141001013', 'Acme Premium A4 Copy Paper 80gsm',
   'High-quality A4 paper, 80g/m², 500 sheets',
   'Premium white copy paper, 80g/m² density. Suitable for all office printers and copiers. FSC certified. ColorLok technology for vivid colours.',
   'Acme', 'Acme SAS', v_off_paper, 'STANDARD', 'REAM', 2.500, 29.7, 21.0, 5.2,
   4.99, 'EUR', FALSE, 'A', '["FSC", "EU Ecolabel", "ColorLok"]',
   96.00, 100.00,
   '{"recycled_content": 0, "fsc_certified": true}',
   '{"fr": {"name": "Papier Acme Premium A4 80g", "short_desc": "Papier A4 haute qualité, 80g/m², 500 feuilles"}, "de": {"name": "Acme Premium A4 Kopierpapier 80g", "short_desc": "Hochwertiges A4-Papier, 80g/m², 500 Blatt"}, "nl": {"name": "Acme Premium A4 kopieerpapier 80g", "short_desc": "Hoogwaardig A4 papier, 80g/m², 500 vel"}}',
   'system'),

  ('b0000001-0001-4000-8000-000000000002', 'PIM_FR', 'PROD-002', 'PUBLISHED',
   'ACM-PAP-A4-REC', '3660141001020', 'Acme Recycled A4 Paper 80gsm',
   'Recycled A4 paper, 80g/m², 500 sheets',
   '100% recycled white copy paper. Blue Angel and EU Ecolabel certified. Compatible with all standard office equipment.',
   'Acme', 'Acme SAS', v_off_paper, 'STANDARD', 'REAM', 2.500, 29.7, 21.0, 5.2,
   5.49, 'EUR', FALSE, 'A+', '["FSC", "Blue Angel", "EU Ecolabel"]',
   94.00, 100.00,
   '{"recycled_content": 100, "fsc_certified": true}',
   '{"fr": {"name": "Papier recyclé Acme A4 80g", "short_desc": "Papier recyclé A4, 80g/m², 500 feuilles"}}',
   'system'),

  ('b0000001-0001-4000-8000-000000000003', 'PIM_FR', 'PROD-003', 'PUBLISHED',
   'PIL-G2-07-BLK', '4902505163111', 'Pilot G2 Gel Pen 0.7mm Black',
   'Retractable gel ink pen, black, medium point',
   'Pilot G2 retractable gel ink rollerball pen. Smooth writing experience with quick-drying gel ink. Refillable. Comfortable rubber grip.',
   'Pilot', 'Pilot Corporation', v_off_write, 'STANDARD', 'EACH', 0.015, 14.8, 1.2, 1.2,
   3.29, 'EUR', FALSE, 'B', NULL,
   92.00, 90.00,
   '{"recycled_content": 0}',
   '{"fr": {"name": "Stylo gel Pilot G2 0.7mm noir"}}',
   'system'),

  ('b0000001-0001-4000-8000-000000000005', 'PIM_FR', 'PROD-005', 'PUBLISHED',
   'LOG-MK270-WL', '5099206039599', 'Logitech MK270 Wireless Keyboard & Mouse',
   'Wireless desktop keyboard and mouse combo',
   'Logitech MK270 wireless combo. Full-size keyboard with numpad. Ambidextrous optical mouse. 2.4 GHz wireless. Up to 24-month battery life.',
   'Logitech', 'Logitech Europe SA', v_tech_acc, 'STANDARD', 'SET', 0.750, 45.0, 15.5, 3.0,
   34.99, 'EUR', FALSE, 'B', '["Energy Star"]',
   90.00, 90.00,
   '{"energy_rating": "A"}',
   '{"fr": {"name": "Clavier et souris sans fil Logitech MK270"}}',
   'system'),

  ('b0000001-0001-4000-8000-000000000007', 'PIM_FR', 'PROD-007', 'PUBLISHED',
   'ANS-TOUCHNTUF', '0076490926327', 'Ansell TouchNTuff 92-600 Nitrile Gloves Box/100',
   'Disposable nitrile examination gloves',
   'Ansell TouchNTuff 92-600. Chemical splash resistance. Textured fingertips. Powder-free. 0.12mm thickness. EN 374 certified.',
   'Ansell', 'Ansell Limited', v_ppe_glove, 'STANDARD', 'BOX', 0.800, 24.0, 10.0, 8.0,
   18.90, 'EUR', FALSE, NULL, '["EN 374", "CE"]',
   85.00, 80.00,
   '{"chemical_class": "Non-hazardous"}',
   '{"fr": {"name": "Gants nitrile Ansell TouchNTuff 92-600 boîte/100"}}',
   'system'),

  ('b0000001-0001-4000-8000-000000000009', 'PIM_FR', 'PROD-009', 'PUBLISHED',
   'DETT-HAND-500', '5011417561539', 'Dettol Antibacterial Hand Wash 500ml',
   'Liquid hand wash, original fragrance',
   'Dettol antibacterial liquid hand wash. Kills 99.9% of bacteria. Dermatologically tested. pH balanced.',
   'Dettol', 'Reckitt Benckiser', v_hyg_soap, 'STANDARD', 'BOTTLE', 0.550, 8.0, 6.0, 21.0,
   4.29, 'EUR', FALSE, 'B', NULL,
   90.00, 90.00,
   '{"chemical_class": "Non-hazardous", "shelf_life_days": 730}',
   '{"fr": {"name": "Savon antibactérien Dettol 500ml"}}',
   'system'),

  -- === APPROVED (1) — approved, awaiting publication ===
  ('b0000001-0001-4000-8000-000000000004', 'PIM_FR', 'PROD-004', 'APPROVED',
   'HP-LJ-M404DN', '0192018902268', 'HP LaserJet Pro M404dn Mono Printer',
   'Professional mono laser printer with duplex',
   'HP LaserJet Pro M404dn. Print speed up to 38 ppm. Automatic duplex printing. Gigabit Ethernet. 256 MB memory. Energy Star certified.',
   'HP', 'HP Inc.', v_tech_print, 'STANDARD', 'EACH', 10.200, 38.1, 36.0, 21.1,
   329.00, 'EUR', FALSE, 'B', '["Energy Star", "EPEAT"]',
   88.00, 90.00,
   '{"energy_rating": "A+"}',
   '{}',
   'system'),

  -- === REVIEW (2) — under product review ===
  ('b0000001-0001-4000-8000-000000000010', 'LEGACY_DE', 'PROD-DE-099', 'REVIEW',
   'ACM-PAP-A4-80G', '3660141001099', 'Acme A4 Copy Paper 80 gsm',
   'A4 paper 80gsm 500 sheets ream',
   NULL,
   'Acme', 'Acme SAS', v_off_paper, 'STANDARD', 'REAM', 2.500, NULL, NULL, NULL,
   4.89, 'EUR', FALSE, NULL, NULL,
   55.00, 60.00,
   '{}',
   '{"de": {"name": "Acme A4 Kopierpapier 80g/m²"}}',
   'system'),

  ('b0000001-0001-4000-8000-000000000011', 'PIM_UK', 'PROD-UK-001', 'REVIEW',
   '3M-NOTE-654YL', '0051131681750', '3M Post-it Notes 76x76mm Yellow 12-Pack',
   'Classic sticky notes, canary yellow, 12 pads',
   '3M Post-it Notes. Original canary yellow. 100 sheets per pad. Sticks securely, removes cleanly. Recyclable packaging.',
   '3M', '3M Company', v_off_paper, 'STANDARD', 'PACK', 0.480, 7.6, 7.6, 12.0,
   12.49, 'GBP', FALSE, 'B', NULL,
   78.00, 80.00,
   '{"recycled_content": 0}',
   '{"fr": {"name": "Post-it 3M 76x76mm jaune lot de 12"}}',
   'system'),

  -- === ENRICHMENT (2) — missing data, needs steward attention ===
  ('b0000001-0001-4000-8000-000000000006', 'PIM_FR', 'PROD-006', 'ENRICHMENT',
   'SIT-LN-ERGO', NULL, 'SitOnIt Novo Ergonomic Task Chair',
   'Ergonomic office chair with lumbar support',
   'SitOnIt Novo high-back task chair. Adjustable lumbar support, 4D armrests. Synchro-tilt mechanism. Certified by BIFMA. Weight capacity 130 kg.',
   'SitOnIt Seating', 'Exemplis Corporation', v_furn_chair, 'STANDARD', 'EACH', 18.500, NULL, NULL, NULL,
   649.00, 'EUR', FALSE, 'A', '["BIFMA", "GREENGUARD"]',
   65.00, 70.00,
   '{"ergonomic_certified": true}',
   '{}',
   'system'),

  ('b0000001-0001-4000-8000-000000000012', 'PIM_FR', 'PROD-012', 'ENRICHMENT',
   'KIM-FACE-100', NULL, 'Kimberly-Clark Professional N95 Respirator',
   'N95 disposable particulate respirator',
   NULL,
   'Kimberly-Clark', 'Kimberly-Clark Professional', v_ppe_mask, 'STANDARD', 'BOX', 0.350, NULL, NULL, NULL,
   29.90, 'EUR', FALSE, NULL, NULL,
   48.00, 50.00,
   '{}',
   '{}',
   'system'),

  -- === DRAFT (2) — just created, minimal data ===
  ('b0000001-0001-4000-8000-000000000008', 'PIM_FR', 'PROD-008', 'DRAFT',
   NULL, NULL, 'Tork Premium Hand Towel Roll H1',
   'Premium paper hand towel roll for system H1',
   NULL,
   'Tork', 'Essity AB', v_hyg_tissue, 'STANDARD', 'ROLL', 1.200, NULL, NULL, NULL,
   45.90, 'EUR', FALSE, NULL, NULL,
   42.00, 50.00,
   '{}',
   '{}',
   'system'),

  ('b0000001-0001-4000-8000-000000000013', 'WEB_FR', 'PROD-NEW-001', 'DRAFT',
   NULL, NULL, 'Leitz IQ Autofeed Office Pro 600 Shredder',
   'Cross-cut auto-feed paper shredder',
   NULL,
   'Leitz', 'ACCO Brands', v_tech_acc, 'STANDARD', 'EACH', 42.000, NULL, NULL, NULL,
   899.00, 'EUR', FALSE, NULL, NULL,
   30.00, 30.00,
   '{}',
   '{}',
   'system'),

  -- === DISCONTINUED (1) — retired product, greyed out ===
  ('b0000001-0001-4000-8000-000000000014', 'PIM_FR', 'PROD-OLD-001', 'DISCONTINUED',
   'ACM-PAP-A3-75', '3660140999001', 'Acme Budget A3 Paper 75gsm',
   'Economy A3 paper, 75g/m², 500 sheets — DISCONTINUED',
   'Discontinued economy range. Replaced by Acme Premium A3 80gsm.',
   'Acme', 'Acme SAS', v_off_paper, 'STANDARD', 'REAM', 3.100, 42.0, 29.7, 5.5,
   6.49, 'EUR', FALSE, 'C', NULL,
   70.00, 80.00,
   '{"recycled_content": 0}',
   '{}',
   'system');

END $$;

-- ============================================================
-- 4. MATCH CANDIDATES — left empty so "Scan for Matches" discovers them live during demo
-- ============================================================
-- (No pre-seeded candidates — the scan button finds BNP Paribas + Acme paper duplicates)

-- ============================================================
-- 5. WORKFLOW INSTANCES — all 4 types × both entity types
-- ============================================================

INSERT INTO mdm.workflow_instance (entity_type, entity_id, workflow_type, current_stage, assigned_to, assigned_role, priority, created_by, notes) VALUES
-- Customer Onboarding: Cabinet Moreau (DRAFT → on its way)
('CUSTOMER', 'a0000001-0001-4000-8000-000000000006', 'ONBOARDING', 'DRAFT', 'alice.martin@example.com', 'DATA_STEWARD', 'HIGH', 'system', 'New SMB customer from web portal'),
-- Customer Onboarding: Greggs (REVIEW stage)
('CUSTOMER', 'a0000001-0001-4000-8000-000000000007', 'ONBOARDING', 'DRAFT', 'sarah.jones@example.com', 'DATA_STEWARD', 'MEDIUM', 'system', 'UK prospect conversion'),
-- Customer Onboarding: Gemeente Amsterdam (REVIEW)
('CUSTOMER', 'a0000001-0001-4000-8000-000000000008', 'ONBOARDING', 'REVIEW', 'benoit.declarens@example.com', 'DATA_STEWARD', 'MEDIUM', 'system', 'Public sector onboarding'),
-- Customer Onboarding: Telefónica (DRAFT — very incomplete)
('CUSTOMER', 'a0000001-0001-4000-8000-000000000011', 'ONBOARDING', 'DRAFT', 'alice.martin@example.com', 'DATA_STEWARD', 'LOW', 'system', 'Spanish prospect, needs enrichment'),
-- Customer Merge: BNP entities
('CUSTOMER', 'a0000001-0001-4000-8000-000000000003', 'MERGE', 'REVIEW', 'benoit.declarens@example.com', 'DATA_MANAGER', 'HIGH', 'system', 'Potential duplicate with BNP Paribas Fortis NV'),
-- Customer Deactivation: Stellantis Italy (SUSPENDED → requesting ARCHIVED)
('CUSTOMER', 'a0000001-0001-4000-8000-000000000012', 'DEACTIVATION', 'DRAFT', 'benoit.declarens@example.com', 'DATA_MANAGER', 'MEDIUM', 'system', 'Account suspended, requesting formal archival'),

-- Product Onboarding: Tork towel (DRAFT)
('PRODUCT', 'b0000001-0001-4000-8000-000000000008', 'ONBOARDING', 'DRAFT', 'product.team@example.com', 'DATA_STEWARD', 'LOW', 'system', 'New hygiene product'),
-- Product Onboarding: Leitz shredder (DRAFT)
('PRODUCT', 'b0000001-0001-4000-8000-000000000013', 'ONBOARDING', 'DRAFT', 'product.team@example.com', 'DATA_STEWARD', 'MEDIUM', 'system', 'New tech accessory from web catalog import'),
-- Product Enrichment: SitOnIt chair (ENRICHMENT — missing EAN and dimensions)
('PRODUCT', 'b0000001-0001-4000-8000-000000000006', 'ENRICHMENT', 'ENRICHMENT', 'product.team@example.com', 'DATA_STEWARD', 'HIGH', 'system', 'Missing EAN, dimensions. Contact manufacturer.'),
-- Product Enrichment: Kimberly-Clark respirator (ENRICHMENT)
('PRODUCT', 'b0000001-0001-4000-8000-000000000012', 'ENRICHMENT', 'ENRICHMENT', 'product.team@example.com', 'DATA_STEWARD', 'HIGH', 'system', 'Missing EAN, long_desc, certifications'),
-- Product Deactivation: Acme Budget A3 (already DISCONTINUED but let's have the workflow visible)
('PRODUCT', 'b0000001-0001-4000-8000-000000000014', 'DEACTIVATION', 'REVIEW', 'product.team@example.com', 'DATA_MANAGER', 'LOW', 'system', 'Budget A3 range discontinued, replaced by Premium');

-- Add some workflow step history for realism
INSERT INTO mdm.workflow_step_log (workflow_id, from_stage, to_stage, action, performed_by, comment) VALUES
(3, 'DRAFT', 'REVIEW', 'APPROVE', 'alice.martin@example.com', 'Data looks complete, forwarding for review'),
(5, 'DRAFT', 'REVIEW', 'APPROVE', 'benoit.declarens@example.com', 'Match candidate confirmed, ready for merge decision'),
(11, 'DRAFT', 'REVIEW', 'APPROVE', 'product.team@example.com', 'Confirmed discontinuation with product management');

-- ============================================================
-- 6. ENTITY COMMENTS — for audit trail & collaboration demo
-- ============================================================

INSERT INTO mdm.entity_comment (entity_type, entity_id, comment_text, created_by) VALUES
('CUSTOMER', 'a0000001-0001-4000-8000-000000000003', 'Key strategic account. Largest financial services customer in France. Ensure premium SLA.', 'benoit.declarens@example.com'),
('CUSTOMER', 'a0000001-0001-4000-8000-000000000009', 'Possible duplicate of BNP Paribas SA — same industry, similar DUNS. Flagged for merge review.', 'alice.martin@example.com'),
('CUSTOMER', 'a0000001-0001-4000-8000-000000000012', 'Account suspended due to payment dispute. Legal team reviewing. Do not reactivate without CFO approval.', 'benoit.declarens@example.com'),
('CUSTOMER', 'a0000001-0001-4000-8000-000000000001', 'Parent account for Renault group hierarchy. UK subsidiary linked as child.', 'system'),
('PRODUCT', 'b0000001-0001-4000-8000-000000000001', 'Best-selling paper product. Maintain top priority for DQ compliance.', 'product.team@example.com'),
('PRODUCT', 'b0000001-0001-4000-8000-000000000006', 'Waiting for manufacturer to confirm EAN. Dimensions to be measured in warehouse.', 'product.team@example.com'),
('PRODUCT', 'b0000001-0001-4000-8000-000000000014', 'Product line discontinued Q4 2024. Remaining stock to be sold through. Do not reorder.', 'product.team@example.com');

-- ============================================================
-- 7. SIMULATE AUDIT TRAIL — realistic recent activity
-- ============================================================

INSERT INTO mdm.audit_log (entity_type, entity_id, action, changed_fields, performed_by, performed_at) VALUES
('CUSTOMER', 'a0000001-0001-4000-8000-000000000001', 'UPDATE', '{"credit_limit": {"old": 400000, "new": 500000}}', 'benoit.declarens@example.com', NOW() - INTERVAL '2 days'),
('CUSTOMER', 'a0000001-0001-4000-8000-000000000003', 'UPDATE', '{"lifecycle_stage": {"old": "VALIDATED", "new": "ACTIVE"}}', 'benoit.declarens@example.com', NOW() - INTERVAL '5 days'),
('CUSTOMER', 'a0000001-0001-4000-8000-000000000006', 'INSERT', '{}', 'alice.martin@example.com', NOW() - INTERVAL '1 day'),
('CUSTOMER', 'a0000001-0001-4000-8000-000000000011', 'INSERT', '{}', 'web_import@example.com', NOW() - INTERVAL '3 hours'),
('CUSTOMER', 'a0000001-0001-4000-8000-000000000012', 'UPDATE', '{"lifecycle_stage": {"old": "ACTIVE", "new": "SUSPENDED"}}', 'benoit.declarens@example.com', NOW() - INTERVAL '10 days'),
('CUSTOMER', 'a0000001-0001-4000-8000-000000000013', 'UPDATE', '{"lifecycle_stage": {"old": "ACTIVE", "new": "ARCHIVED"}}', 'benoit.declarens@example.com', NOW() - INTERVAL '30 days'),
('PRODUCT', 'b0000001-0001-4000-8000-000000000001', 'UPDATE', '{"list_price": {"old": 4.79, "new": 4.99}}', 'product.team@example.com', NOW() - INTERVAL '7 days'),
('PRODUCT', 'b0000001-0001-4000-8000-000000000008', 'INSERT', '{}', 'product.team@example.com', NOW() - INTERVAL '2 days'),
('PRODUCT', 'b0000001-0001-4000-8000-000000000013', 'INSERT', '{}', 'web_import@example.com', NOW() - INTERVAL '6 hours'),
('PRODUCT', 'b0000001-0001-4000-8000-000000000014', 'UPDATE', '{"lifecycle_stage": {"old": "PUBLISHED", "new": "DISCONTINUED"}}', 'product.team@example.com', NOW() - INTERVAL '15 days');

-- ============================================================
-- 8. FIX SEQUENCES — ensure next inserts don't hit duplicate keys
-- ============================================================
SELECT setval('mdm.audit_log_id_seq',         COALESCE((SELECT MAX(id) FROM mdm.audit_log), 0) + 1, false);
SELECT setval('mdm.workflow_instance_id_seq',  COALESCE((SELECT MAX(id) FROM mdm.workflow_instance), 0) + 1, false);
SELECT setval('mdm.workflow_step_log_id_seq',  COALESCE((SELECT MAX(id) FROM mdm.workflow_step_log), 0) + 1, false);
SELECT setval('mdm.dq_result_id_seq',          COALESCE((SELECT MAX(id) FROM mdm.dq_result), 0) + 1, false);
SELECT setval('mdm.entity_comment_id_seq',     COALESCE((SELECT MAX(id) FROM mdm.entity_comment), 0) + 1, false);
SELECT setval('mdm.match_candidate_id_seq',    COALESCE((SELECT MAX(id) FROM mdm.match_candidate), 0) + 1, false);
SELECT setval('mdm.merge_history_id_seq',      COALESCE((SELECT MAX(id) FROM mdm.merge_history), 0) + 1, false);

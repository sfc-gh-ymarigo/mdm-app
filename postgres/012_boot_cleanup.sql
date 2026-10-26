-- 012: DQ rule columns and one-time clean-ups that used to run at every API start.

ALTER TABLE mdm.dq_rule ADD COLUMN IF NOT EXISTS source VARCHAR(20);
ALTER TABLE mdm.dq_rule ADD COLUMN IF NOT EXISTS field_name VARCHAR(100);
ALTER TABLE mdm.dq_rule ADD COLUMN IF NOT EXISTS template_id VARCHAR(60);
UPDATE mdm.dq_rule SET source = 'MANUAL' WHERE source IS NULL;

-- Manual rules superseded by function-based templates
DELETE FROM mdm.dq_result WHERE rule_id IN (
  SELECT id FROM mdm.dq_rule WHERE source = 'MANUAL' AND rule_code IN (
    'CUST_EMAIL_RFC5322', 'CUST_PHONE_E164', 'CUST_TAX_ID_CHECK', 'CUST_SIRET_LUHN',
    'CUST_ADDR_COHERENCE', 'CUS_VALID_EMAIL', 'CUS_VALID_TAXID'));
DELETE FROM mdm.dq_rule WHERE source = 'MANUAL' AND rule_code IN (
  'CUST_EMAIL_RFC5322', 'CUST_PHONE_E164', 'CUST_TAX_ID_CHECK', 'CUST_SIRET_LUHN',
  'CUST_ADDR_COHERENCE', 'CUS_VALID_EMAIL', 'CUS_VALID_TAXID');

-- Template rules from before the fn_validate_* functions (regex versions)
DELETE FROM mdm.dq_result WHERE rule_id IN (
  SELECT id FROM mdm.dq_rule WHERE source = 'TEMPLATE' AND template_id IN ('FORMAT_EMAIL', 'FORMAT_PHONE')
     AND sql_expression NOT LIKE '%fn\_%');
DELETE FROM mdm.dq_rule WHERE source = 'TEMPLATE' AND template_id IN ('FORMAT_EMAIL', 'FORMAT_PHONE')
   AND sql_expression NOT LIKE '%fn\_%';

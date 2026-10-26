/**
 * DQ Template Engine
 * Generates SQL DQ rules from field metadata + template definitions.
 */

export interface FieldMeta {
  name: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'ref' | 'json' | 'uuid';
  group: string;
  required?: boolean;
  ref_domain?: string;
  max_length?: number;
}

export interface DqTemplate {
  id: string;
  label: string;
  description: string;
  ruleType: string;          // COMPLETENESS, VALIDITY, CONSISTENCY, UNIQUENESS
  defaultSeverity: string;   // WARNING or ERROR
  appliesTo: (field: FieldMeta) => boolean;
  generateSQL: (field: FieldMeta) => string;
  generateRuleCode: (field: FieldMeta, entityPrefix: string) => string;
  generateRuleName: (field: FieldMeta) => string;
}

// ── Template Definitions ──────────────────────────────────────────────────────

const COMPLETENESS: DqTemplate = {
  id: 'COMPLETENESS',
  label: 'Completeness',
  description: 'Field must not be NULL or empty',
  ruleType: 'COMPLETENESS',
  defaultSeverity: 'WARNING',
  appliesTo: () => true,
  generateSQL: (f) => f.type === 'text'
    ? `${f.name} IS NOT NULL AND TRIM(${f.name}) != ''`
    : `${f.name} IS NOT NULL`,
  generateRuleCode: (f, pre) => `${pre}_COMP_${f.name}`.toUpperCase(),
  generateRuleName: (f) => `${f.label} must not be empty`,
};

const FORMAT_EMAIL: DqTemplate = {
  id: 'FORMAT_EMAIL',
  label: 'Validate: email (RFC 5322)',
  description: 'Email validated via fn_validate_email (RFC 5322 compliant)',
  ruleType: 'VALIDITY',
  defaultSeverity: 'ERROR',
  appliesTo: (f) => f.type === 'text' && /email/i.test(f.name),
  generateSQL: (f) => `${f.name} IS NULL OR (SELECT valid FROM mdm.fn_validate_email(${f.name}) LIMIT 1)`,
  generateRuleCode: (f, pre) => `${pre}_FMT_EMAIL`.toUpperCase(),
  generateRuleName: (f) => `${f.label} must be a valid email (RFC 5322)`,
};

const FORMAT_PHONE: DqTemplate = {
  id: 'FORMAT_PHONE',
  label: 'Validate: phone (E.164)',
  description: 'Phone validated via fn_validate_phone_e164 with country match',
  ruleType: 'VALIDITY',
  defaultSeverity: 'WARNING',
  appliesTo: (f) => f.type === 'text' && /phone|fax|mobile|tel/i.test(f.name),
  generateSQL: (f) => `${f.name} IS NULL OR (SELECT valid FROM mdm.fn_validate_phone_e164(${f.name}, country_code) LIMIT 1)`,
  generateRuleCode: (f, pre) => `${pre}_FMT_${f.name}`.toUpperCase(),
  generateRuleName: (f) => `${f.label} must be a valid phone (E.164 + country)`,
};

const FORMAT_URL: DqTemplate = {
  id: 'FORMAT_URL',
  label: 'Format: URL',
  description: 'Must be a valid URL',
  ruleType: 'VALIDITY',
  defaultSeverity: 'WARNING',
  appliesTo: (f) => f.type === 'text' && /website|url|homepage/i.test(f.name),
  generateSQL: (f) => `${f.name} IS NULL OR ${f.name} ~* '^https?://.+'`,
  generateRuleCode: (f, pre) => `${pre}_FMT_URL`.toUpperCase(),
  generateRuleName: (f) => `${f.label} must be a valid URL`,
};

const FORMAT_COUNTRY: DqTemplate = {
  id: 'FORMAT_COUNTRY',
  label: 'Format: ISO country',
  description: 'Must be a country code from the Countries reference list (ISO 3166 alpha-3)',
  ruleType: 'VALIDITY',
  defaultSeverity: 'ERROR',
  appliesTo: (f) => (f.type === 'text' || f.type === 'ref') && /country_code|country$/i.test(f.name),
  generateSQL: (f) => `${f.name} IS NULL OR EXISTS (SELECT 1 FROM mdm.ref_country rc WHERE rc.code = ${f.name})`,
  generateRuleCode: (f, pre) => `${pre}_FMT_COUNTRY`.toUpperCase(),
  generateRuleName: (f) => `${f.label} must be a known ISO country code`,
};

const FORMAT_CURRENCY: DqTemplate = {
  id: 'FORMAT_CURRENCY',
  label: 'Format: ISO currency',
  description: 'Must be a 3-letter ISO currency code',
  ruleType: 'VALIDITY',
  defaultSeverity: 'ERROR',
  appliesTo: (f) => (f.type === 'text' || f.type === 'ref') && /currency/i.test(f.name),
  generateSQL: (f) => `${f.name} IS NULL OR ${f.name} ~ '^[A-Z]{3}$'`,
  generateRuleCode: (f, pre) => `${pre}_FMT_CURRENCY`.toUpperCase(),
  generateRuleName: (f) => `${f.label} must be a 3-letter ISO code`,
};

const REFERENTIAL: DqTemplate = {
  id: 'REFERENTIAL',
  label: 'Referential integrity',
  description: 'Value must exist in the reference codelist',
  ruleType: 'CONSISTENCY',
  defaultSeverity: 'ERROR',
  appliesTo: (f) => f.type === 'ref' && !!f.ref_domain,
  generateSQL: (f) => `${f.name} IS NULL OR ${f.name} IN (SELECT code FROM mdm.ref_codelist WHERE domain = '${f.ref_domain}' AND is_active = true)`,
  generateRuleCode: (f, pre) => `${pre}_REF_${f.name}`.toUpperCase(),
  generateRuleName: (f) => `${f.label} must match ${f.ref_domain} codelist`,
};

const UNIQUENESS: DqTemplate = {
  id: 'UNIQUENESS',
  label: 'Uniqueness',
  description: 'Values must be unique across all records',
  ruleType: 'UNIQUENESS',
  defaultSeverity: 'ERROR',
  appliesTo: (f) => f.type === 'text' || f.type === 'uuid',
  generateSQL: (f) => `(SELECT COUNT(*) FROM __TABLE__ t2 WHERE t2.${f.name} = __TABLE_ALIAS__.${f.name} AND t2.is_deleted = false) <= 1`,
  generateRuleCode: (f, pre) => `${pre}_UNQ_${f.name}`.toUpperCase(),
  generateRuleName: (f) => `${f.label} must be unique`,
};

const POSITIVE_NUMBER: DqTemplate = {
  id: 'POSITIVE_NUMBER',
  label: 'Positive value',
  description: 'Numeric value must be positive (> 0)',
  ruleType: 'VALIDITY',
  defaultSeverity: 'WARNING',
  appliesTo: (f) => f.type === 'number' && /price|cost|msrp|weight|quantity|count|revenue|spend|score|pct|rate/i.test(f.name),
  generateSQL: (f) => `${f.name} IS NULL OR ${f.name} > 0`,
  generateRuleCode: (f, pre) => `${pre}_POS_${f.name}`.toUpperCase(),
  generateRuleName: (f) => `${f.label} must be positive`,
};

const PERCENTAGE_RANGE: DqTemplate = {
  id: 'PERCENTAGE_RANGE',
  label: 'Percentage range',
  description: 'Value must be between 0 and 100',
  ruleType: 'VALIDITY',
  defaultSeverity: 'ERROR',
  appliesTo: (f) => f.type === 'number' && /pct|percent|rate/i.test(f.name),
  generateSQL: (f) => `${f.name} IS NULL OR (${f.name} >= 0 AND ${f.name} <= 100)`,
  generateRuleCode: (f, pre) => `${pre}_RNG_${f.name}`.toUpperCase(),
  generateRuleName: (f) => `${f.label} must be between 0 and 100`,
};

const VALIDATE_TAX_ID: DqTemplate = {
  id: 'VALIDATE_TAX_ID',
  label: 'Validate: tax ID checksum',
  description: 'Tax ID validated via fn_validate_tax_id with country-specific checksum',
  ruleType: 'VALIDITY',
  defaultSeverity: 'ERROR',
  appliesTo: (f) => f.type === 'text' && /tax_id|vat_number|tax_number/i.test(f.name),
  generateSQL: (f) => `${f.name} IS NULL OR (SELECT valid FROM mdm.fn_validate_tax_id(${f.name}, country_code) LIMIT 1)`,
  generateRuleCode: (f, pre) => `${pre}_VAL_TAXID`.toUpperCase(),
  generateRuleName: (f) => `${f.label} must pass checksum validation`,
};

const VALIDATE_SIRET: DqTemplate = {
  id: 'VALIDATE_SIRET',
  label: 'Validate: SIRET/SIREN (Luhn)',
  description: 'SIRET validated via fn_validate_siret with Luhn checksum & SIREN coherence',
  ruleType: 'VALIDITY',
  defaultSeverity: 'WARNING',
  appliesTo: (f) => f.type === 'text' && /siret/i.test(f.name),
  generateSQL: (f) => `${f.name} IS NULL OR (SELECT valid FROM mdm.fn_validate_siret(${f.name}, siren) LIMIT 1)`,
  generateRuleCode: (f, pre) => `${pre}_VAL_SIRET`.toUpperCase(),
  generateRuleName: (f) => `${f.label} must pass Luhn checksum & SIREN coherence`,
};

const VALIDATE_ADDRESS: DqTemplate = {
  id: 'VALIDATE_ADDRESS',
  label: 'Validate: address coherence',
  description: 'Address validated via fn_validate_address (street, city, postal code, country)',
  ruleType: 'CONSISTENCY',
  defaultSeverity: 'WARNING',
  appliesTo: (f) => f.type === 'text' && /address_line1|address_street/i.test(f.name),
  generateSQL: (f) => `${f.name} IS NULL OR (SELECT valid FROM mdm.fn_validate_address(${f.name}, city, postal_code, country_code) LIMIT 1)`,
  generateRuleCode: (f, pre) => `${pre}_VAL_ADDR`.toUpperCase(),
  generateRuleName: () => `Address must be coherent (street, city, postal code, country)`,
};

// ── All templates in evaluation order ─────────────────────────────────────────

export const ALL_TEMPLATES: DqTemplate[] = [
  COMPLETENESS,
  FORMAT_EMAIL,
  FORMAT_PHONE,
  FORMAT_URL,
  FORMAT_COUNTRY,
  FORMAT_CURRENCY,
  REFERENTIAL,
  UNIQUENESS,
  POSITIVE_NUMBER,
  PERCENTAGE_RANGE,
  VALIDATE_TAX_ID,
  VALIDATE_SIRET,
  VALIDATE_ADDRESS,
];

// ── Public API ────────────────────────────────────────────────────────────────

export function getApplicableTemplates(field: FieldMeta): DqTemplate[] {
  return ALL_TEMPLATES.filter(t => t.appliesTo(field));
}

export interface TemplateSelection {
  templateId: string;
  fieldName: string;
  severity?: string;
}

export interface GeneratedRule {
  entity_type: string;
  rule_code: string;
  rule_name: string;
  rule_type: string;
  severity: string;
  sql_expression: string;
  source: 'TEMPLATE';
  field_name: string;
  template_id: string;
}

export function generateRule(
  template: DqTemplate,
  field: FieldMeta,
  entityType: string,
  severity?: string,
): GeneratedRule {
  const prefix = entityType.substring(0, 3);
  // Field names and codelist domains come from config and are pasted into SQL
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(field.name)) throw new Error(`Invalid field name: ${field.name}`);
  if (field.ref_domain !== undefined && !/^[A-Z][A-Z0-9_]{0,62}$/.test(String(field.ref_domain))) throw new Error(`Invalid codelist domain: ${field.ref_domain}`);
  let sql = template.generateSQL(field);
  // For uniqueness template, replace table placeholders
  const table = `mdm.${entityType.toLowerCase()}`;
  sql = sql.replace(/__TABLE__/g, table).replace(/__TABLE_ALIAS__/g, table);

  return {
    entity_type: entityType.toUpperCase(),
    rule_code: template.generateRuleCode(field, prefix),
    rule_name: template.generateRuleName(field),
    rule_type: template.ruleType,
    severity: severity || template.defaultSeverity,
    sql_expression: sql,
    source: 'TEMPLATE',
    field_name: field.name,
    template_id: template.id,
  };
}

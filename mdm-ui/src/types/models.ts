import { liveColors, stageColor } from '../theme/brandColors';
export interface Customer {
  id: string;
  golden_id: string | null;
  source_system: string;
  source_id: string;
  lifecycle_stage: string;
  legal_name: string;
  trade_name: string | null;
  tax_id: string | null;
  duns_number: string | null;
  siren: string | null;
  siret: string | null;
  address_line1: string | null;
  city: string | null;
  postal_code: string | null;
  country_code: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  customer_type: string | null;
  segment: string | null;
  industry_code: string | null;
  parent_id: string | null;
  dq_score: number | null;
  completeness: number | null;
  extended_attrs: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  golden_id: string | null;
  source_system: string;
  source_id: string;
  lifecycle_stage: string;
  sku: string | null;
  ean: string | null;
  name: string;
  short_desc: string | null;
  long_desc: string | null;
  brand: string | null;
  manufacturer: string | null;
  category_id: number | null;
  product_type: string | null;
  unit_of_measure: string | null;
  weight_kg: number | null;
  list_price: number | null;
  currency_code: string | null;
  hazardous: boolean;
  esg_rating: string | null;
  country_code?: string | null;
  dq_score: number | null;
  completeness: number | null;
  translations: Record<string, Record<string, string>>;
  extended_attrs: Record<string, unknown>;
  primary_image: string | null;
  category_name?: string | null;
  category_code?: string | null;
  parent_category_name?: string | null;
  parent_category_code?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface MatchCandidate {
  id: number;
  entity_type: string;
  entity_id_a: string;
  entity_id_b: string;
  match_score: number;
  match_method: string;
  match_fields: Record<string, unknown>;
  status: string;
}

export interface WorkflowInstance {
  id: number;
  entity_type: string;
  entity_id: string;
  workflow_type: string;
  current_stage: string;
  assigned_to: string | null;
  assigned_role: string | null;
  priority: string;
  notes: string | null;
  payload: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
  completed_at?: string | null;
  entity_name?: string;
  available_transitions?: WorkflowTransition[];
}

export interface MergeHistoryEntry {
  id: number;
  entity_type: string;
  survivor_id: string;
  merged_id: string;
  survivor_name: string | null;
  merged_name: string | null;
  golden_id: string | null;
  merged_by: string;
  merged_at: string;
  unmerged_at: string | null;
  unmerged_by: string | null;
  can_unmerge: boolean;
}

export interface WorkflowTransition {
  to_stage: string;
  required_role: string | null;
}

export interface AuditEntry {
  id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  changed_fields: Record<string, { old: unknown; new: unknown }> | null;
  performed_by: string;
  performed_at: string;
  entity_name?: string;
}

export interface DqRuleResult {
  rule_code: string;
  rule_name: string;
  rule_type: string;
  severity: string;
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
}

export interface DqRule {
  id: number;
  entity_type: string;
  rule_code: string;
  rule_name: string;
  rule_type: string;
  category: string | null;
  sql_expression: string;
  severity: string;
  is_active: boolean;
  created_at: string;
  total: number;
  passed: number;
  failed: number;
}

export interface DqFailure {
  entity_id: string;
  name: string;
  lifecycle_stage: string;
  evaluated_at: string;
  [key: string]: unknown;
}

export interface DqFailureResponse {
  rule: { id: number; entity_type: string; rule_code: string; rule_name: string };
  failures: DqFailure[];
}

export interface GoldenRecord {
  golden_id: string;
  entity_type: string;
  golden_name: string;
  dq_score: number | null;
  lifecycle_stage: string;
  sources: { id: string; source_system: string; source_id: string; name: string; is_deleted: boolean; dq_score: number | null; lifecycle_stage: string }[];
  active_count: number;
  merged_count: number;
}

export interface GoldenRecordDetail {
  golden_id: string;
  entity_type: string;
  survivor: Customer | Product;
  merged: (Customer | Product)[];
  xrefs: { id: string; source_system: string; source_id: string; is_survivor: boolean }[];
  merge_history: { id: number; survivor_id: string; merged_id: string; survivorship: Record<string, { source: string; value: unknown }>; merged_by: string; merged_at: string; survivor_name: string; merged_name: string }[];
  audit_trail: AuditEntry[];
}

export type LifecycleStage = 'DRAFT' | 'REVIEW' | 'VALIDATED' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED'
  | 'ENRICHMENT' | 'APPROVED' | 'PUBLISHED' | 'DISCONTINUED';

// Live view on the branding status colors (see theme/brandColors)
export const STAGE_COLORS: Record<string, string> = liveColors(
  ['DRAFT', 'REVIEW', 'VALIDATED', 'ACTIVE', 'SUSPENDED', 'ARCHIVED', 'ENRICHMENT', 'APPROVED', 'PUBLISHED', 'DISCONTINUED'], stageColor);

export const CUSTOMER_STAGES = ['DRAFT', 'REVIEW', 'VALIDATED', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
export const PRODUCT_STAGES  = ['DRAFT', 'ENRICHMENT', 'REVIEW', 'APPROVED', 'PUBLISHED', 'DISCONTINUED'] as const;

export const CUSTOMER_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['REVIEW'],
  REVIEW: ['VALIDATED', 'DRAFT'],
  VALIDATED: ['ACTIVE'],
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE'],
};

export const PRODUCT_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['ENRICHMENT'],
  ENRICHMENT: ['REVIEW'],
  REVIEW: ['APPROVED', 'ENRICHMENT'],
  APPROVED: ['PUBLISHED'],
  PUBLISHED: ['DISCONTINUED'],
};

export const WORKFLOW_TYPES = ['ONBOARDING', 'ENRICHMENT', 'MERGE', 'DEACTIVATION', 'HIERARCHY_CHANGE'] as const;

export const WORKFLOW_TARGET_STAGES: Record<string, Record<string, string>> = {
  ONBOARDING:   { CUSTOMER: 'ACTIVE',       PRODUCT: 'PUBLISHED' },
  ENRICHMENT:   { CUSTOMER: 'VALIDATED',     PRODUCT: 'REVIEW' },
  MERGE:        { CUSTOMER: 'ACTIVE',        PRODUCT: 'APPROVED' },
  DEACTIVATION:     { CUSTOMER: 'ARCHIVED',      PRODUCT: 'DISCONTINUED' },
  HIERARCHY_CHANGE: { CUSTOMER: 'APPROVED',      PRODUCT: 'APPROVED' },
};

export function getWorkflowStages(entityType: string, workflowType: string): string[] {
  // Deactivation has its own short approval path
  if (workflowType === 'DEACTIVATION') {
    const terminal = entityType === 'PRODUCT' ? 'DISCONTINUED' : 'ARCHIVED';
    return ['DRAFT', 'REVIEW', terminal];
  }
  if (workflowType === 'HIERARCHY_CHANGE') {
    return ['DRAFT', 'REVIEW', 'APPROVED'];
  }
  const all: string[] = entityType === 'CUSTOMER' ? [...CUSTOMER_STAGES] : [...PRODUCT_STAGES];
  const target = WORKFLOW_TARGET_STAGES[workflowType]?.[entityType];
  if (!target) return all;
  const targetIdx = all.indexOf(target);
  if (targetIdx === -1) return all;
  return all.slice(0, targetIdx + 1);
}

import type { Customer, Product, MatchCandidate, WorkflowInstance, AuditEntry, DqRuleResult, DqRule, DqFailureResponse, GoldenRecord, GoldenRecordDetail, WorkflowTransition, MergeHistoryEntry } from '../types/models';
import { getCurrentUserEmail } from '../context/UserContext';

export interface DqTemplateInfo {
  id: string; label: string; description: string; ruleType: string; defaultSeverity: string;
  selected: boolean; severity: string; ruleId?: number;
}
export interface DqFieldTemplates {
  field: { name: string; label: string; type: string; group: string; required?: boolean; ref_domain?: string };
  templates: DqTemplateInfo[];
}
export interface DqFieldGroup { group: string; fields: DqFieldTemplates[] }
export interface DqTemplateConfig {
  entityType: string; totalFields: number; coveredFields: number; customRuleCount: number;
  fieldGroups: DqFieldGroup[];
}
export interface DqRunHistory {
  rule_code: string; rule_name: string; entity_type: string;
  runs: Array<{ pass_rate: number; total: number; passed: number; failed: number; run_at: string }>;
}
export interface DqTemplateSelection {
  fieldName: string; templateId: string; severity: string; selected: boolean;
}

const API = '/api';

/** Server-side paged list response (endpoints return it when ?page is given). */
export interface Paged<T> { rows: T[]; total: number; page: number; size: number }
export interface Facets { total: number; facets: Record<string, { value: string; count: number }[]> }
const qs = (p?: URLSearchParams | Record<string, string | number | undefined | null>) => {
  if (!p) return '';
  if (p instanceof URLSearchParams) return p.toString();
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  return u.toString();
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('x-mdm-user', getCurrentUserEmail());
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      detail = body.detail || body.error || detail;
      if (body.constraint) detail += ` [${body.constraint}]`;
    } catch { /* no JSON body */ }
    throw new Error(detail);
  }
  return res.json();
}

export const productsApi = {
  page: (params: URLSearchParams) => fetchJson<Paged<Product>>(`${API}/products?${params}`),
};

export type EntityRecord = Record<string, unknown> & { id: string; golden_id?: string | null; lifecycle_stage?: string; dq_score?: number | string | null; completeness?: number | string | null; is_deleted?: boolean; created_at?: string; updated_at?: string; source_system?: string; source_id?: string };

export interface RecordContext {
  entity_type: string;
  golden_id: string | null;
  dq: { failed: number; total: number; results: { rule_id: number; rule_code: string; rule_name: string; severity: string; category: string | null; passed: boolean; evaluated_at: string }[] };
  workflows: { id: number; workflow_type: string; current_stage: string; priority: string; assigned_to: string | null; created_by: string; created_at: string; completed_at: string | null; steps: number }[];
  comments: { id: number; comment_text: string; created_by: string; created_at: string }[];
  merges: { id: number; survivor_id: string; merged_id: string; merged_by: string; merged_at: string; unmerged_at: string | null }[];
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const entityBase = (moduleId: string) => `${API}/entities/${moduleId}`;

/** Module-agnostic record access. */
export const entityApi = {
  page: (moduleId: string, params: URLSearchParams) => fetchJson<Paged<EntityRecord>>(`${API}/entities/${moduleId}?${params}`),
  facets: (moduleId: string) => fetchJson<Facets>(`${API}/entities/${moduleId}/facets`),
  /** Fuzzy (trigram) name search; modules without fuzzy config fall back to a substring search. */
  search: async (moduleId: string, q: string): Promise<(EntityRecord & { score?: number })[]> => {
    try { return await fetchJson(`${API}/entities/${moduleId}/search?q=${encodeURIComponent(q)}`); }
    catch { return (await fetchJson<Paged<EntityRecord>>(`${API}/entities/${moduleId}?${qs({ page: 0, size: 10, q })}`)).rows; }
  },
  get: (moduleId: string, id: string) => fetchJson<EntityRecord>(`${API}/entities/${moduleId}/${id}`),
  create: (moduleId: string, data: Record<string, unknown>) => fetchJson<EntityRecord>(entityBase(moduleId), json('POST', data)),
  update: (moduleId: string, id: string, data: Record<string, unknown>) => fetchJson<EntityRecord & { _hierarchy_workflow?: { id: number; message: string }; ignored_fields?: string[] }>(`${entityBase(moduleId)}/${id}`, json('PUT', data)),
  delete: (moduleId: string, id: string) => fetchJson<{ success: boolean }>(`${entityBase(moduleId)}/${id}`, { method: 'DELETE' }),
  context: (moduleId: string, id: string) => fetchJson<RecordContext>(`${API}/records/${moduleId}/${id}/context`),
  addComment: (moduleId: string, id: string, text: string) => fetchJson<RecordContext['comments'][number]>(`${API}/records/${moduleId}/${id}/comments`, json('POST', { text })),
};

export interface WorkflowDetail extends WorkflowInstance {
  steps: { from_stage: string; to_stage: string; action: string; performed_by: string; comment: string | null; performed_at: string }[];
}

export const matchApi = {
  /** Pending candidates, one page; `records` holds both sides of each pair on the page. */
  page: (params: URLSearchParams) => fetchJson<Paged<MatchCandidate> & { records: Record<string, Customer | Product> }>(`${API}/matches?${params}`),
  counts: () => fetchJson<Record<string, number>>(`${API}/matches/counts`),
  resolve: (id: number, action: 'CONFIRMED' | 'REJECTED', opts?: { survivor_id?: string; field_overrides?: Record<string, 'A' | 'B'> }) =>
    fetchJson<void>(`${API}/matches/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: action, ...opts }) }),
  scan: (entityType?: string, methods?: string[]) => fetchJson<{ status: string; results: Record<string, number>[] }>(`${API}/matches/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity_type: entityType, methods }) }),
  enrich: (methods?: string[]) => fetchJson<{ status: string; results: { type: string; embedding: number; llm: number }[] }>(`${API}/matches/enrich`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ methods }) }),
  merges: () => fetchJson<MergeHistoryEntry[]>(`${API}/matches/merges`),
  mergesPage: (params: URLSearchParams) => fetchJson<Paged<MergeHistoryEntry>>(`${API}/matches/merges?${params}`),
  unmerge: (id: number, force = false) => fetchJson<{ status: string; survivor_id: string; restored_id: string; moved_back: { children: number; workflows: number; comments: number } }>(`${API}/matches/merges/${id}/unmerge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force }) }),
  aiDedup: (id: number) => fetchJson<{ status: string; candidate: MatchCandidate }>(`${API}/matches/${id}/ai-dedup`, { method: 'POST' }),
};

export const workflowApi = {
  get: (id: number | string) => fetchJson<WorkflowDetail>(`${API}/workflows/${id}`),
  page: (params: URLSearchParams) => fetchJson<Paged<WorkflowInstance>>(`${API}/workflows?${params}`),
  counts: () => fetchJson<{ entity_type: string; workflow_type: string; count: number }[]>(`${API}/workflows/counts`),
  create: (body: { entity_type: string; entity_id: string; workflow_type: string; priority?: string; assigned_to?: string }) => fetchJson<WorkflowInstance>(`${API}/workflows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  advance: (id: number, action: 'APPROVE' | 'REJECT', comment?: string, toStage?: string) => fetchJson<{ advanced: boolean; from_stage: string; new_stage: string; terminal: boolean; entity_stage: string | null; next_required_role?: string | null; available_transitions: WorkflowTransition[] }>(`${API}/workflows/${id}/advance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, comment, to_stage: toStage }) }),
  cancel: (id: number, comment?: string) => fetchJson<{ cancelled: boolean }>(`${API}/workflows/${id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment }) }),
  reassign: (id: number, assigned_to?: string, assigned_role?: string) => fetchJson<WorkflowInstance>(`${API}/workflows/${id}/assign`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assigned_to, assigned_role }) }),
  updatePriority: (id: number, priority: string) => fetchJson<WorkflowInstance>(`${API}/workflows/${id}/assign`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority }) }),
};

export const auditApi = {
  list: (entityType?: string, entityId?: string, filters: { user?: string; action?: string } = {}) => {
    const q = new URLSearchParams({ entity_type: entityType ?? '', entity_id: entityId ?? '' });
    if (filters.user) q.set('user', filters.user);
    if (filters.action) q.set('action', filters.action);
    return fetchJson<AuditEntry[]>(`${API}/audit?${q}`);
  },
  page: (params: URLSearchParams) => fetchJson<Paged<AuditEntry>>(`${API}/audit?${params}`),
};


export const dqApi = {
  summary: () => fetchJson<DqRuleResult[]>(`${API}/dq/summary`),
  history: (entityType?: string) => fetchJson<DqRunHistory[]>(`${API}/dq/history${entityType ? `?entity_type=${entityType}` : ''}`),
  run: (entityType: string, ruleIds?: number[]) => fetchJson<{ status: string; rules_evaluated: number; entities_checked: number; results_written: number }>(
    `${API}/dq/run/${entityType}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ruleIds ? { rule_ids: ruleIds } : {}) },
  ),
  listRules: () => fetchJson<DqRule[]>(`${API}/dq/rules`),
  createRule: (body: Partial<DqRule>) => fetchJson<DqRule>(`${API}/dq/rules`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  updateRule: (id: number, body: Partial<DqRule>) => fetchJson<DqRule>(`${API}/dq/rules/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  deleteRule: (id: number) => fetchJson<void>(`${API}/dq/rules/${id}`, { method: 'DELETE' }),
  failures: (ruleId: number, params?: Record<string, string | number | undefined>) => fetchJson<DqFailureResponse & { total?: number }>(`${API}/dq/failures/${ruleId}${params ? `?${qs(params)}` : ''}`),
  getTemplates: (entityType: string) => fetchJson<DqTemplateConfig>(`${API}/dq/templates/${entityType}`),
  applyTemplates: (entityType: string, selections: DqTemplateSelection[]) =>
    fetchJson<{ status: string; created: number; activated: number; deactivated: number; total_changes: number }>(
      `${API}/dq/templates/${entityType}/apply`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selections }) },
    ),
};

export const statsApi = {
  dashboard: () => fetchJson<DashboardStats>(`${API}/stats/dashboard`),
};

export const goldenApi = {
  page: (params: URLSearchParams) => fetchJson<Paged<GoldenRecord>>(`${API}/golden?${params}`),
  get: (id: string) => fetchJson<GoldenRecordDetail>(`${API}/golden/${encodeURIComponent(id)}`),
  bulkStage: (entityType: string, ids: string[], stage: string) =>
    fetchJson<{ updated: number }>(`${API}/golden/bulk-stage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity_type: entityType, ids, stage }) }),
};

export interface ModuleStats {
  id: string;
  label: string;
  labels: Record<string, string>;
  icon: string;
  total: number;
  /** Stage reached at the end of onboarding (ACTIVE, PUBLISHED …) */
  live_stage: string;
  live: number;
  avg_dq_score: number;
  avg_completeness: number;
  by_stage: Record<string, number>;
  by_country: { country: string; count: number }[] | null;
  /** One entry per configured list filter (other than stage and country) */
  breakdowns: { field: string; label: string; values: { key: string; value: string; count: number }[] }[];
  /** Records created in the last 30 days */
  created_30d: number;
}

export interface DashboardStats {
  modules: ModuleStats[];
  pending_workflows: number;
  pending_matches: number;
  dq_by_type: { rule_type: string; rule_count: number; pass_rate: number }[];
  activity_summary: { entity_type: string; action: string; count: number }[];
  /** Open workflows of the caller; unassigned = no assignee or 'system' */
  my_work: {
    mine: number; mine_high: number; mine_overdue: number; overdue: number; unassigned: number;
    top: { id: number; entity_type: string; entity_id: string; workflow_type: string; current_stage: string; priority: string; due_date: string | null; entity_name: string | null }[];
  };
  trends: {
    workflows_opened_30d: number;
    workflows_closed_30d: number;
    /** Daily overall DQ rule pass rate, empty until rules have run */
    dq_pass_rate: { day: string; pass_rate: number }[];
    dq_pass_rate_delta: number | null;
    /** Last 30 days, one row per day */
    activity: { day: string; INSERT: number; UPDATE: number; DELETE: number }[];
  };
}

// ============================================================
// Module System — Type Definitions
// ============================================================
// Every MDM entity (customer, product, supplier, plant, etc.)
// is described by a ModuleConfig. The generic CRUD router,
// UI components, and Snowflake layer all read from this config.
// ============================================================

export interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'ref' | 'json' | 'uuid';
  group: string;                     // UI grouping: 'core', 'address', 'contact', 'classification', 'compliance', 'dimensions', 'pricing'
  required?: boolean;
  unique?: boolean;
  searchable?: boolean;              // included in ILIKE search
  filterable?: boolean;              // exposed as filter dropdown in list view
  trigram?: boolean;                 // create pg_trgm GIN index for fuzzy matching
  ref_domain?: string;               // for type='ref': codelist domain or ref table
  ref_table?: string;                // for type='ref': e.g. 'mdm.ref_country' (code/name)
  pg_type?: string;                  // override Postgres type (default: inferred from type)
  default_value?: unknown;           // SQL default expression
  max_length?: number;
  list_display?: boolean;            // show in list table (default: false for non-core fields)
  list_width?: number;               // column width hint in px
  card_display?: boolean;            // show in card/summary view
  editable?: boolean;                // allow editing (default: true)

  // Field activation & catalog
  active?: boolean;                   // field is active in the app (default: true for backward compat)
  builtin?: boolean;                  // part of the pre-configured catalog (can't delete, only toggle)
}

export interface JoinDef {
  alias: string;                     // e.g. 'c' for category
  table: string;                     // e.g. 'mdm.product_category'
  on: string;                        // e.g. 'c.id = {table}.category_id'
  type?: 'LEFT' | 'INNER';          // default: LEFT
  columns: Record<string, string>;   // { category_name: 'c.name', category_code: 'c.code' }
}

export interface ModuleConfig {
  id: string;                        // 'customer', 'product', 'supplier'
  label: string;                     // 'Customers', 'Products', 'Suppliers'
  singular: string;                  // 'Customer', 'Product', 'Supplier'
  labels?: Record<string, string>;   // translated plural label by locale, e.g. { fr: 'Clients' }
  singular_labels?: Record<string, string>;
  icon: string;                      // MUI icon name: 'People', 'Inventory2', 'LocalShipping'
  table: string;                     // 'mdm.customer', 'mdm.product'
  enabled: boolean;
  allow_create?: boolean;              // allow manual record creation from UI (default: true)
  order: number;                     // nav sort order

  // Entity-specific name field (displayed in lists, search results, audit trail)
  name_field: string;                // 'legal_name', 'name', 'company_name'

  // Golden ID prefix (default 'G' + first letter of id: GC, GP, GS)
  golden_prefix?: string;

  // Schema
  fields: FieldDef[];

  // Joins for list/detail views (e.g. product → category)
  joins?: JoinDef[];

  // Country-scoped RLS (only for entities with a country_code field)
  country_scoped?: boolean;
  /** Rows with no country stay visible to every country-scoped role (Snowflake policies). */
  country_null_all?: boolean;

  // Search configuration
  search: {
    fields: string[];                // fields for ILIKE search
    fuzzy?: {                        // optional trigram fuzzy search endpoint
      fields: string[];              // fields for similarity()
      threshold?: number;            // default 0.3
    };
  };

  // Filtering
  filters: Array<{
    field: string;
    label: string;
    type: 'select' | 'multiselect';
    options_from?: 'distinct' | string; // 'distinct' = query distinct values; string = ref_domain
  }>;

  // Matching/dedup
  matching?: {
    enabled: boolean;
    fields: string[];                // fields used for dedup scoring
    blocking?: string[];             // only compare records equal on these columns (e.g. ['country_code']); none = all pairs
    max_token_frequency?: number;    // fuzzy/composite: words shared by more records than this are not blocking keys (default 50)
    max_candidates?: number;         // per stage cap on new candidates (default 1000)
    methods?: {
      exact_keys?: { enabled: boolean; keys: string[] };
      fuzzy?: { enabled: boolean; threshold: number; name_field: string };
      phonetic?: { enabled: boolean; fields: string[] };
      composite?: { enabled: boolean; threshold: number; weights: Record<string, number>; rules?: { field: string; weight: number; compare: string; min_sim?: number }[] };
      embedding?: { enabled: boolean; model: string; threshold: number; description_fields: string[] };
      llm_judge?: { enabled: boolean; model: string };
      address?: { enabled: boolean; fields: string[] };
    };
  };

  // Hierarchy
  hierarchy?: {
    enabled: boolean;
    parent_field: string;            // 'parent_id'
    root_label: string;              // 'Customer Accounts'
    type: 'self' | 'category';      // 'self' = same table; 'category' = separate category table
    category_table?: string;         // for type='category': 'mdm.product_category'
    max_depth?: number | null;       // null = unlimited
    max_parents?: number;            // default 1
    allow_root?: boolean;            // allow records with no parent
    prevent_circular?: boolean;      // prevent circular references
    change_mode?: 'immediate' | 'workflow'; // how hierarchy changes are applied
  };

  // Post-operation hooks (function names in Postgres)
  hooks?: {
    after_update?: string;           // e.g. 'mdm.fn_compute_product_completeness'
    after_create?: string;
  };

  // Workflow config
  workflow?: {
    auto_create_on_insert: boolean;  // create onboarding workflow on new record
    types: string[];                 // ['ONBOARDING', 'UPDATE', 'MERGE', 'DEACTIVATION']
  };
}

// Module registry — loaded from config.json at startup
export interface ModuleRegistry {
  modules: ModuleConfig[];
  getModule(id: string): ModuleConfig | undefined;
  getEnabled(): ModuleConfig[];
}

/**
 * Guards for the few places where text ends up inside SQL statements.
 *
 *  - assertIdent / isIdent: plain lower-case identifiers (column names, aliases)
 *  - validateRuleExpression: custom DQ rule boolean expressions (tokenizer + allow-lists)
 *  - validateFunctionDdl: a single CREATE OR REPLACE FUNCTION mdm.fn_* … LANGUAGE plpgsql
 */

const IDENT_RE = /^[a-z_][a-z0-9_]{0,62}$/;

export function isIdent(s: unknown): s is string {
  return typeof s === 'string' && IDENT_RE.test(s);
}

export class SqlGuardError extends Error {
  status = 400;
}

export function assertIdent(s: unknown, what = 'identifier'): string {
  if (!isIdent(s)) throw new SqlGuardError(`Invalid ${what}: ${String(s).slice(0, 64)}`);
  return s;
}

// ── DQ rule expressions ──────────────────────────────────────────────────────

const FUNCTIONS = new Set([
  'length', 'char_length', 'lower', 'upper', 'trim', 'btrim', 'ltrim', 'rtrim', 'coalesce', 'nullif',
  'abs', 'round', 'floor', 'ceil', 'now', 'current_date', 'date_part', 'age', 'substring', 'left', 'right',
  'jsonb_typeof', 'jsonb_array_length', 'array_length', 'cardinality', 'regexp_like',
]);

const KEYWORDS = new Set([
  'and', 'or', 'not', 'is', 'null', 'true', 'false', 'in', 'like', 'ilike', 'between',
  'case', 'when', 'then', 'else', 'end', 'distinct', 'from', // `from` only as IS DISTINCT FROM (checked below)
]);

// Anything that could change state, read other tables or escape the expression.
const FORBIDDEN = new Set([
  'select', 'insert', 'update', 'delete', 'merge', 'drop', 'alter', 'create', 'truncate', 'grant', 'revoke',
  'copy', 'execute', 'do', 'call', 'union', 'into', 'returning', 'with', 'set', 'reset', 'listen', 'notify',
  'begin', 'commit', 'rollback', 'pg_sleep', 'current_setting', 'set_config', 'lo_import', 'lo_export',
]);

type Tok = { t: 'ident' | 'num' | 'str' | 'op' | 'punct'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") {
      let j = i + 1, v = '';
      for (;;) {
        if (j >= src.length) throw new SqlGuardError('Unterminated string literal');
        if (src[j] === "'") { if (src[j + 1] === "'") { v += "'"; j += 2; continue; } break; }
        v += src[j++];
      }
      out.push({ t: 'str', v }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i))!;
      out.push({ t: 'num', v: m[0] }); i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?/.exec(src.slice(i))!;
      out.push({ t: 'ident', v: m[0].toLowerCase() }); i += m[0].length; continue;
    }
    const op = /^(<>|!=|>=|<=|\|\||::|!~\*|!~|~\*|[=<>~+\-*/%])/.exec(src.slice(i));
    if (op) {
      if (src.startsWith('--', i) || src.startsWith('/*', i)) throw new SqlGuardError('Comments are not allowed');
      out.push({ t: 'op', v: op[0] }); i += op[0].length; continue;
    }
    if (c === '(' || c === ')' || c === ',') { out.push({ t: 'punct', v: c }); i++; continue; }
    throw new SqlGuardError(`Character not allowed in rule expression: ${c}`);
  }
  return out;
}

const CAST_TYPES = new Set(['text', 'int', 'integer', 'numeric', 'date', 'timestamp', 'timestamptz', 'boolean', 'jsonb', 'varchar']);

/**
 * Validate a custom DQ rule: a boolean expression over the entity's own columns.
 * `columns` = column names of the target table. Validation functions are allowed only
 * in the template form `(SELECT valid FROM mdm.fn_xxx(args) LIMIT 1)`.
 */
export function validateRuleExpression(expr: unknown, columns: Set<string>, validationFns: Set<string>): string {
  if (typeof expr !== 'string' || !expr.trim()) throw new SqlGuardError('sql_expression is required');
  if (expr.length > 2000) throw new SqlGuardError('sql_expression is too long (max 2000 characters)');
  if (expr.includes(';')) throw new SqlGuardError('Semicolons are not allowed');
  const toks = tokenize(expr);

  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const k = toks[i];
    if (k.t === 'punct') {
      if (k.v === '(') depth++;
      if (k.v === ')' && --depth < 0) throw new SqlGuardError('Unbalanced parentheses');
      continue;
    }
    if (k.t !== 'ident') continue;
    const prev = toks[i - 1], next = toks[i + 1];

    // (SELECT valid FROM mdm.fn_name( … ) LIMIT 1) — the only subquery form allowed
    if (k.v === 'select') {
      const fn = toks[i + 3];
      if (prev?.v === '(' && next?.v === 'valid' && toks[i + 2]?.v === 'from' && fn?.t === 'ident'
          && /^mdm\.fn_[a-z0-9_]+$/.test(fn.v) && validationFns.has(fn.v.slice(4)) && toks[i + 4]?.v === '(') {
        // find matching close paren of the function call, then expect LIMIT 1 )
        let d = 0, j = i + 4;
        for (; j < toks.length; j++) {
          if (toks[j].v === '(') d++;
          else if (toks[j].v === ')' && --d === 0) break;
        }
        if (toks[j + 1]?.v === 'limit' && toks[j + 2]?.v === '1' && toks[j + 3]?.v === ')') {
          // Arguments are validated by the main loop as ordinary tokens; skip the fixed words.
          toks[i + 1] = { t: 'punct', v: ',' }; toks[i + 2] = { t: 'punct', v: ',' };
          toks[i + 3] = { t: 'punct', v: ',' }; toks[j + 1] = { t: 'punct', v: ',' };
          toks[j + 2] = { t: 'num', v: '1' };
          continue;
        }
      }
      throw new SqlGuardError('Subqueries are not allowed (validation functions: (SELECT valid FROM mdm.fn_x(...) LIMIT 1))');
    }
    if (FORBIDDEN.has(k.v)) throw new SqlGuardError(`Keyword not allowed: ${k.v.toUpperCase()}`);
    if (k.v === 'from' && !(prev?.v === 'distinct')) throw new SqlGuardError('FROM is only allowed in IS DISTINCT FROM');
    if (KEYWORDS.has(k.v)) continue;
    if (prev?.v === '::') {
      if (!CAST_TYPES.has(k.v)) throw new SqlGuardError(`Cast type not allowed: ${k.v}`);
      continue;
    }
    if (next?.v === '(') {
      if (!FUNCTIONS.has(k.v)) throw new SqlGuardError(`Function not allowed: ${k.v}`);
      continue;
    }
    if (k.v.includes('.')) throw new SqlGuardError(`Qualified names are not allowed: ${k.v}`);
    if (!columns.has(k.v)) throw new SqlGuardError(`Unknown column: ${k.v}`);
  }
  if (depth !== 0) throw new SqlGuardError('Unbalanced parentheses');
  return expr.trim();
}

// ── Validation function DDL ──────────────────────────────────────────────────

/** Split on top-level semicolons, ignoring those inside quotes, dollar-quoted bodies and comments. */
export function splitStatements(sql: string): string[] {
  const parts: string[] = [];
  let cur = '', i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    const dollar = /^\$[A-Za-z_]*\$/.exec(rest);
    if (dollar) {
      const end = sql.indexOf(dollar[0], i + dollar[0].length);
      if (end < 0) throw new SqlGuardError('Unterminated dollar-quoted body');
      cur += sql.slice(i, end + dollar[0].length); i = end + dollar[0].length; continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      cur += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (rest.startsWith('--')) { const e = sql.indexOf('\n', i); i = e < 0 ? sql.length : e; continue; }
    if (rest.startsWith('/*')) { const e = sql.indexOf('*/', i); if (e < 0) throw new SqlGuardError('Unterminated comment'); i = e + 2; continue; }
    if (sql[i] === ';') { if (cur.trim()) parts.push(cur.trim()); cur = ''; i++; continue; }
    cur += sql[i++];
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

export function validateFunctionDdl(sql: unknown, name: string): string {
  if (typeof sql !== 'string') throw new SqlGuardError('definition is required');
  const stmts = splitStatements(sql);
  if (stmts.length !== 1) throw new SqlGuardError('Exactly one CREATE OR REPLACE FUNCTION statement is allowed');
  const stmt = stmts[0];
  const head = new RegExp(`^create\\s+or\\s+replace\\s+function\\s+mdm\\.${name}\\s*\\(`, 'i');
  if (!head.test(stmt)) throw new SqlGuardError(`Statement must start with CREATE OR REPLACE FUNCTION mdm.${name}(`);
  // Everything outside the dollar-quoted body
  const outside = stmt.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, ' ');
  if (!/\blanguage\s+plpgsql\b/i.test(outside)) throw new SqlGuardError('Only LANGUAGE plpgsql functions are allowed');
  if (/\bsecurity\s+definer\b/i.test(outside)) throw new SqlGuardError('SECURITY DEFINER is not allowed');
  if (/\bset\s+(role|session_authorization|search_path)\b/i.test(outside)) throw new SqlGuardError('SET clauses are not allowed');
  if (!/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/.test(stmt)) throw new SqlGuardError('Function body must be dollar-quoted');
  return stmt;
}

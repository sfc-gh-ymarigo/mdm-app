import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  type Node, type Edge, Handle, Position,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Box, Typography, Chip, CircularProgress, alpha, useTheme } from '@mui/material';
import KeyIcon from '@mui/icons-material/Key';
import LinkIcon from '@mui/icons-material/Link';
import { getCurrentUserEmail } from '../context/UserContext';
import { tr } from '../i18n';
import { statusColors, seriesColor } from '../theme/brandColors';

type SchemaColumn = {
  name: string; type: string; nullable: boolean;
  max_length: number | null; is_pk: boolean;
};

type SchemaTable = { name: string; columns: SchemaColumn[] };

type SchemaFK = {
  name: string; from_table: string; from_column: string;
  to_table: string; to_column: string;
};

type SchemaData = { tables: SchemaTable[]; foreign_keys: SchemaFK[] };

// Categorise tables for colour coding
const TABLE_CATEGORIES: Record<string, { color: string; label: string }> = {
  customer: { get color() { return seriesColor(0); }, label: tr('schemaERD.entity') },
  product: { get color() { return seriesColor(8); }, label: tr('schemaERD.entity') },
  product_category: { get color() { return seriesColor(8); }, label: tr('schemaERD.entity') },
  workflow_instance: { get color() { return seriesColor(3); }, label: tr('schemaERD.workflow') },
  workflow_step_log: { get color() { return seriesColor(3); }, label: tr('schemaERD.workflow') },
  dq_rule: { get color() { return seriesColor(7); }, label: tr('schemaERD.quality') },
  dq_result: { get color() { return seriesColor(7); }, label: tr('schemaERD.quality') },
  match_candidate: { get color() { return seriesColor(2); }, label: tr('schemaERD.matching') },
  merge_history: { get color() { return seriesColor(2); }, label: tr('schemaERD.matching') },
  audit_log: { get color() { return seriesColor(11); }, label: tr('schemaERD.audit') },
  entity_comment: { get color() { return seriesColor(11); }, label: tr('schemaERD.audit') },
  ref_codelist: { get color() { return seriesColor(5); }, label: tr('schemaERD.reference') },
  ref_country: { get color() { return seriesColor(5); }, label: tr('schemaERD.reference') },
  ref_currency: { get color() { return seriesColor(5); }, label: tr('schemaERD.reference') },
  ref_language: { get color() { return seriesColor(5); }, label: tr('schemaERD.reference') },
  ref_lifecycle_stage: { get color() { return seriesColor(5); }, label: tr('schemaERD.reference') },
  ref_lifecycle_transition: { get color() { return seriesColor(5); }, label: tr('schemaERD.reference') },
  app_user: { get color() { return statusColors().neutral; }, label: tr('schemaERD.system') },
  attribute_definition: { get color() { return statusColors().neutral; }, label: tr('schemaERD.system') },
};

const DEFAULT_CAT = { get color() { return statusColors().neutral; }, label: tr('schemaERD.other') };

function getCategory(name: string) {
  return TABLE_CATEGORIES[name] ?? DEFAULT_CAT;
}

// --- Custom Table Node ---
function TableNode({ data }: { data: any }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const cat = getCategory(data.tableName);
  const fkCols = new Set<string>((data.fkColumns ?? []) as string[]);

  const disabled = !!data.disabled;

  return (
    <Box sx={{
      minWidth: 220, maxWidth: 300,
      border: `2px solid ${disabled ? alpha(cat.color, 0.3) : cat.color}`,
      borderRadius: '8px',
      bgcolor: alpha(theme.palette.background.paper, 0.95),
      boxShadow: disabled ? 'none' : `0 2px 12px ${alpha(cat.color, 0.25)}`,
      fontSize: '0.75rem',
      overflow: 'hidden',
      opacity: disabled ? 0.45 : 1,
      filter: disabled ? 'grayscale(0.6)' : 'none',
      transition: 'opacity 0.3s, filter 0.3s',
    }}>
      {/* Header */}
      <Box sx={{
        bgcolor: cat.color, color: '#fff',
        px: 1.5, py: 0.8,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.8rem', color: '#fff' }}>
          {data.tableName}
        </Typography>
        {disabled ? (
          <Chip label="disabled" size="small" sx={{
            fontSize: '0.6rem', height: 18, color: '#fff',
            bgcolor: alpha('#000', 0.35), fontWeight: 600, fontStyle: 'italic',
          }} />
        ) : (
          <Chip label={cat.label} size="small" sx={{
            fontSize: '0.6rem', height: 18, color: '#fff',
            bgcolor: alpha('#fff', 0.25), fontWeight: 600,
          }} />
        )}
      </Box>

      {/* Columns */}
      <Box sx={{ px: 0.5, py: 0.5 }}>
        {(data.columns as SchemaColumn[]).map((col) => (
          <Box key={col.name} sx={{
            display: 'flex', alignItems: 'center', gap: 0.5,
            px: 1, py: 0.25, borderRadius: 0.5,
            position: 'relative',
            '&:hover': { bgcolor: isDark ? alpha('#fff', 0.05) : alpha('#000', 0.04) },
          }}>
            {/* Source handle for FK columns */}
            {fkCols.has(col.name) && (
              <Handle
                type="source"
                position={Position.Right}
                id={`${data.tableName}.${col.name}`}
                style={{ background: cat.color, width: 8, height: 8, right: -4, top: '50%' }}
              />
            )}
            {/* Target handle for PK columns */}
            {col.is_pk && (
              <Handle
                type="target"
                position={Position.Left}
                id={`${data.tableName}.${col.name}`}
                style={{ background: cat.color, width: 8, height: 8, left: -4, top: '50%' }}
              />
            )}
            {col.is_pk ? (
              <KeyIcon sx={{ fontSize: 13, color: statusColors().warning }} />
            ) : fkCols.has(col.name) ? (
              <LinkIcon sx={{ fontSize: 13, color: cat.color }} />
            ) : (
              <Box sx={{ width: 13 }} />
            )}
            <Typography sx={{
              fontFamily: 'monospace', fontSize: '0.72rem',
              fontWeight: col.is_pk ? 700 : 400,
              color: theme.palette.text.primary,
              flex: 1,
            }}>
              {col.name}
            </Typography>
            <Typography sx={{
              fontFamily: 'monospace', fontSize: '0.65rem',
              color: alpha(theme.palette.text.secondary, 0.8),
            }}>
              {col.type === 'character varying' ? `varchar(${col.max_length ?? ''})` :
               col.type === 'timestamp without time zone' ? 'timestamp' :
               col.type === 'timestamp with time zone' ? 'timestamptz' :
               col.type}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

const nodeTypes = { tableNode: TableNode };

// --- Layout helper: arrange tables in a grid ---
function layoutNodes(tables: SchemaTable[], fks: SchemaFK[], disabledTables: Set<string> = new Set()): Node[] {
  // Group tables by category
  const groups: Record<string, SchemaTable[]> = {};
  for (const t of tables) {
    const cat = getCategory(t.name);
    (groups[cat.label] ??= []).push(t);
  }

  // Build FK column lookup per table
  const fkColumns: Record<string, string[]> = {};
  for (const fk of fks) {
    (fkColumns[fk.from_table] ??= []).push(fk.from_column);
  }

  // Layout: entities left, ref right, workflow/quality/matching/audit center-bottom
  const groupOrder = ['Entity', 'Reference', 'Workflow', 'Quality', 'Matching', 'Audit', 'System', 'Other'];
  const nodeHeight = (t: SchemaTable) => 50 + t.columns.length * 22;

  const nodes: Node[] = [];
  let groupX = 0;

  for (const gName of groupOrder) {
    const gTables = groups[gName];
    if (!gTables || gTables.length === 0) continue;

    let colY = 0;
    const maxWidth = 300;

    for (const t of gTables) {
      nodes.push({
        id: t.name,
        type: 'tableNode',
        position: { x: groupX, y: colY },
        data: {
          tableName: t.name,
          columns: t.columns,
          fkColumns: fkColumns[t.name] ?? [],
          disabled: disabledTables.has(t.name),
        },
      });
      colY += nodeHeight(t) + 40;
    }
    groupX += maxWidth + 100;
  }

  return nodes;
}

function buildEdges(fks: SchemaFK[]): Edge[] {
  return fks.map(fk => ({
    id: fk.name,
    source: fk.from_table,
    sourceHandle: `${fk.from_table}.${fk.from_column}`,
    target: fk.to_table,
    targetHandle: `${fk.to_table}.${fk.to_column}`,
    type: 'smoothstep',
    animated: true,
    style: { stroke: getCategory(fk.from_table).color, strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: getCategory(fk.from_table).color },
    label: fk.from_column,
    labelStyle: { fontSize: 10, fontFamily: 'monospace', fill: '#999' },
    labelBgStyle: { fill: 'transparent' },
  }));
}

// Map module IDs to their owned tables
const MODULE_TABLES: Record<string, string[]> = {
  CUSTOMER: ['customer'],
  PRODUCT: ['product', 'product_category'],
  SUPPLIER: ['supplier'],
};

export default function SchemaERD({ disabledModules = [] }: { accent?: string; disabledModules?: string[] }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [schema, setSchema] = useState<SchemaData | null>(null);
  const [loading, setLoading] = useState(true);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const disabledTables = useMemo(() => {
    const set = new Set<string>();
    for (const modId of disabledModules) {
      for (const t of MODULE_TABLES[modId] ?? []) set.add(t);
    }
    return set;
  }, [disabledModules]);

  useEffect(() => {
    fetch('/api/admin/schema', { headers: { 'x-mdm-user': getCurrentUserEmail() } })
      .then(r => r.json())
      .then((data: SchemaData) => {
        setSchema(data);
        setNodes(layoutNodes(data.tables, data.foreign_keys, disabledTables));
        setEdges(buildEdges(data.foreign_keys));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [disabledTables]);

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  }

  if (!schema || schema.tables.length === 0) {
    return <Typography color="text.secondary">{tr('schemaERD.noTablesFoundInThe')}</Typography>;
  }

  return (
    <Box sx={{
      height: 650, border: `1px solid ${isDark ? alpha('#fff', 0.1) : alpha('#000', 0.1)}`,
      borderRadius: 2, overflow: 'hidden',
    }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background color={theme.palette.divider} gap={20} />
        <Controls
          showInteractive={false}
          style={{ background: theme.palette.background.paper, borderRadius: 8 }}
        />
        <MiniMap
          nodeColor={(n: any) => getCategory(n.id).color}
          maskColor={isDark ? 'rgba(0,0,0,0.7)' : 'rgba(200,200,200,0.5)'}
          style={{ borderRadius: 8 }}
        />
      </ReactFlow>
    </Box>
  );
}

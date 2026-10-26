import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Drawer, Box, Typography, IconButton, LinearProgress, Chip, alpha, Button,
  Checkbox, FormControlLabel, Collapse, Select, MenuItem, CircularProgress,
  Tooltip, useTheme, Divider,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import SelectAllIcon from '@mui/icons-material/SelectAll';
import DeselectIcon from '@mui/icons-material/Deselect';
import { dqApi } from '../api/client';
import type { DqFieldGroup, DqTemplateSelection, DqFieldTemplates } from '../api/client';
import { tr } from '../i18n';

import { statusColors } from '../theme/brandColors';
interface Props {
  open: boolean;
  onClose: () => void;
  entityType: string;
  entityLabel: string;
  onApplied: () => void;
}

type LocalState = Map<string, { selected: boolean; severity: string }>;

function buildKey(fieldName: string, templateId: string) {
  return `${fieldName}::${templateId}`;
}

export default function DqConfigPanel({ open, onClose, entityType, entityLabel, onApplied }: Props) {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [fieldGroups, setFieldGroups] = useState<DqFieldGroup[]>([]);
  const [totalFields, setTotalFields] = useState(0);
  const [customRuleCount, setCustomRuleCount] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());

  // Local state tracking user changes (key = "fieldName::templateId")
  const [localState, setLocalState] = useState<LocalState>(new Map());
  // Original state from server (to compute diff)
  const [serverState, setServerState] = useState<LocalState>(new Map());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await dqApi.getTemplates(entityType);
      setFieldGroups(data.fieldGroups);
      setTotalFields(data.totalFields);
      setCustomRuleCount(data.customRuleCount);

      // Build initial state from server data
      const state: LocalState = new Map();
      for (const g of data.fieldGroups) {
        for (const f of g.fields) {
          for (const t of f.templates) {
            state.set(buildKey(f.field.name, t.id), { selected: t.selected, severity: t.severity });
          }
        }
      }
      setServerState(new Map(state));
      setLocalState(new Map(state));
      // Auto-expand first group
      if (data.fieldGroups.length > 0) {
        setExpandedGroups(new Set([data.fieldGroups[0].group]));
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [entityType]);

  useEffect(() => { if (open) fetchData(); }, [open, fetchData]);

  // Compute changes
  const changes = useMemo(() => {
    const diff: DqTemplateSelection[] = [];
    for (const [key, local] of localState) {
      const server = serverState.get(key);
      if (!server || local.selected !== server.selected || (local.selected && local.severity !== server.severity)) {
        const [fieldName, templateId] = key.split('::');
        diff.push({ fieldName, templateId, severity: local.severity, selected: local.selected });
      }
    }
    return diff;
  }, [localState, serverState]);

  // Coverage
  const coveredFields = useMemo(() => {
    const covered = new Set<string>();
    for (const [key, val] of localState) {
      if (val.selected) covered.add(key.split('::')[0]);
    }
    return covered.size;
  }, [localState]);

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  };

  const toggleField = (fieldName: string) => {
    setExpandedFields(prev => {
      const next = new Set(prev);
      if (next.has(fieldName)) next.delete(fieldName); else next.add(fieldName);
      return next;
    });
  };

  const updateTemplate = (fieldName: string, templateId: string, selected: boolean, severity?: string) => {
    setLocalState(prev => {
      const next = new Map(prev);
      const key = buildKey(fieldName, templateId);
      const current = next.get(key);
      next.set(key, { selected, severity: severity ?? current?.severity ?? 'WARNING' });
      return next;
    });
  };

  const selectAllRequired = () => {
    setLocalState(prev => {
      const next = new Map(prev);
      for (const g of fieldGroups) {
        for (const f of g.fields) {
          if (f.field.required) {
            const key = buildKey(f.field.name, 'COMPLETENESS');
            const current = next.get(key);
            if (current) next.set(key, { ...current, selected: true });
          }
        }
      }
      return next;
    });
  };

  const clearAll = () => {
    setLocalState(prev => {
      const next = new Map(prev);
      for (const [key, val] of next) {
        next.set(key, { ...val, selected: false });
      }
      return next;
    });
  };

  const handleApply = async () => {
    if (changes.length === 0) return;
    setApplying(true);
    try {
      await dqApi.applyTemplates(entityType, changes);
      await fetchData();
      onApplied();
    } catch (e) { console.error(e); }
    setApplying(false);
  };

  const coveragePct = totalFields > 0 ? Math.round((coveredFields / totalFields) * 100) : 0;

  function CoverageDots({ fields }: { fields: DqFieldTemplates[] }) {
    return (
      <Box sx={{ display: 'flex', gap: 0.3, alignItems: 'center' }}>
        {fields.map(f => {
          const hasActive = f.templates.some(t => localState.get(buildKey(f.field.name, t.id))?.selected);
          return (
            <Tooltip key={f.field.name} title={hasActive ? tr('dqConfigPanel.covered', { field: f.field.label }) : tr('dqConfigPanel.notCovered', { field: f.field.label })}>
              <Box sx={{
                width: 8, height: 8, borderRadius: '50%',
                bgcolor: hasActive ? statusColors().success : alpha(theme.palette.text.disabled, 0.3),
              }} />
            </Tooltip>
          );
        })}
      </Box>
    );
  }

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: 480, p: 0 } }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 700 }}>{tr('dqConfigPanel.dqConfiguration')}</Typography>
            <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>{entityLabel}</Typography>
          </Box>
          <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
        </Box>

        {loading ? (
          <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>
        ) : (
          <>
            {/* Coverage */}
            <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${theme.palette.divider}` }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{tr('dqConfigPanel.dqCoverage')}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, color: coveragePct >= 70 ? statusColors().success : coveragePct >= 40 ? statusColors().warning : statusColors().error }}>
                  {coveredFields}/{totalFields} fields — {coveragePct}%
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate" value={coveragePct}
                sx={{
                  height: 6, borderRadius: 3, mb: 1,
                  bgcolor: alpha(coveragePct >= 70 ? statusColors().success : coveragePct >= 40 ? statusColors().warning : statusColors().error, 0.15),
                  '& .MuiLinearProgress-bar': { bgcolor: coveragePct >= 70 ? statusColors().success : coveragePct >= 40 ? statusColors().warning : statusColors().error, borderRadius: 3 },
                }}
              />
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button size="small" startIcon={<SelectAllIcon />} onClick={selectAllRequired} sx={{ fontSize: '0.7rem', textTransform: 'none' }}>
                  {tr('dqConfigPanel.selectAllRequired')}
                </Button>
                <Button size="small" startIcon={<DeselectIcon />} onClick={clearAll} sx={{ fontSize: '0.7rem', textTransform: 'none' }}>
                  {tr('dqConfigPanel.clearAll')}
                </Button>
              </Box>
            </Box>

            {/* Field groups */}
            <Box sx={{ flex: 1, overflow: 'auto', px: 0 }}>
              {fieldGroups.map(g => {
                const isExpanded = expandedGroups.has(g.group);
                const groupCovered = g.fields.filter(f => f.templates.some(t => localState.get(buildKey(f.field.name, t.id))?.selected)).length;

                return (
                  <Box key={g.group}>
                    <Box
                      onClick={() => toggleGroup(g.group)}
                      sx={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        px: 2, py: 1, cursor: 'pointer',
                        bgcolor: alpha(theme.palette.text.primary, 0.02),
                        borderBottom: `1px solid ${theme.palette.divider}`,
                        '&:hover': { bgcolor: alpha(theme.palette.text.primary, 0.04) },
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {isExpanded ? <ExpandMoreIcon sx={{ fontSize: 18 }} /> : <ChevronRightIcon sx={{ fontSize: 18 }} />}
                        <Typography variant="body2" sx={{ fontWeight: 600, textTransform: 'capitalize', fontSize: '0.85rem' }}>
                          {g.group}
                        </Typography>
                        <Chip label={tr('dqConfigPanel.fieldsCount', { count: g.fields.length })} size="small" sx={{ fontSize: '0.6rem', height: 18 }} />
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
                          {groupCovered}/{g.fields.length}
                        </Typography>
                        <CoverageDots fields={g.fields} />
                      </Box>
                    </Box>

                    <Collapse in={isExpanded}>
                      {g.fields.map(f => {
                        const isFieldExpanded = expandedFields.has(f.field.name);
                        const fieldHasActive = f.templates.some(t => localState.get(buildKey(f.field.name, t.id))?.selected);

                        return (
                          <Box key={f.field.name} sx={{ borderBottom: `1px solid ${alpha(theme.palette.divider, 0.5)}` }}>
                            <Box
                              onClick={() => toggleField(f.field.name)}
                              sx={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                px: 2, pl: 4, py: 0.8, cursor: 'pointer',
                                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.04) },
                              }}
                            >
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                {fieldHasActive
                                  ? <CheckCircleIcon sx={{ fontSize: 16, color: statusColors().success }} />
                                  : <RadioButtonUncheckedIcon sx={{ fontSize: 16, color: theme.palette.text.disabled }} />}
                                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: isFieldExpanded ? 600 : 400 }}>
                                  {f.field.name}
                                </Typography>
                                {f.field.required && (
                                  <Chip label="required" size="small" sx={{ fontSize: '0.55rem', height: 16, bgcolor: alpha(statusColors().error, 0.1), color: statusColors().error }} />
                                )}
                              </Box>
                              <Chip label={f.field.type.toUpperCase()} size="small" variant="outlined" sx={{ fontSize: '0.55rem', height: 18 }} />
                            </Box>

                            <Collapse in={isFieldExpanded}>
                              <Box sx={{ pl: 6, pr: 2, pb: 1 }}>
                                {f.templates.map(t => {
                                  const key = buildKey(f.field.name, t.id);
                                  const state = localState.get(key);
                                  const isSelected = state?.selected ?? false;
                                  const severity = state?.severity ?? t.defaultSeverity;

                                  return (
                                    <Box key={t.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.3 }}>
                                      <FormControlLabel
                                        control={
                                          <Checkbox
                                            size="small" checked={isSelected}
                                            onChange={(_, checked) => updateTemplate(f.field.name, t.id, checked)}
                                            sx={{ py: 0.3 }}
                                          />
                                        }
                                        label={
                                          <Tooltip title={t.description}>
                                            <Typography variant="caption" sx={{ fontSize: '0.78rem' }}>{t.label}</Typography>
                                          </Tooltip>
                                        }
                                        sx={{ mr: 0 }}
                                      />
                                      {isSelected && (
                                        <Select
                                          size="small" value={severity}
                                          onChange={(e) => updateTemplate(f.field.name, t.id, true, e.target.value)}
                                          sx={{ fontSize: '0.7rem', height: 24, minWidth: 90, '& .MuiSelect-select': { py: 0.3 } }}
                                        >
                                          <MenuItem value="WARNING" sx={{ fontSize: '0.75rem' }}>WARNING</MenuItem>
                                          <MenuItem value="ERROR" sx={{ fontSize: '0.75rem' }}>ERROR</MenuItem>
                                        </Select>
                                      )}
                                    </Box>
                                  );
                                })}
                              </Box>
                            </Collapse>
                          </Box>
                        );
                      })}
                    </Collapse>
                  </Box>
                );
              })}

              {/* Custom rules summary */}
              <Divider />
              <Box sx={{ px: 2, py: 1.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem', mb: 0.5 }}>
                  {tr('dqConfigPanel.customRules')}
                </Typography>
                <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
                  {tr('dqConfigPanel.manualRules', { count: customRuleCount })}
                </Typography>
              </Box>
            </Box>

            {/* Apply button */}
            <Box sx={{ p: 2, borderTop: `1px solid ${theme.palette.divider}` }}>
              <Button
                variant="contained" fullWidth
                onClick={handleApply}
                disabled={changes.length === 0 || applying}
                startIcon={applying ? <CircularProgress size={16} /> : undefined}
              >
                {changes.length === 0 ? tr('dqConfigPanel.noChanges') : `Apply ${changes.length} change${changes.length > 1 ? 's' : ''}`}
              </Button>
            </Box>
          </>
        )}
      </Box>
    </Drawer>
  );
}

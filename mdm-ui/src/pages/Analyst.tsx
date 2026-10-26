import { useState, useRef, useEffect } from 'react';
import {
  Box, Typography, TextField, IconButton, alpha, Card, Chip, useTheme,
  CircularProgress, Table, TableHead, TableRow, TableCell, TableBody,
  TableContainer, Paper,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import StorageIcon from '@mui/icons-material/Storage';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ShieldIcon from '@mui/icons-material/Shield';
import { useUser } from '../context/UserContext';
import { getCurrentUserEmail } from '../context/UserContext';
import { GoldenChip, RecordLink } from '../components/common/Links';
import { tr, localized } from '../i18n';
import { useBrand, type ModuleConfig } from '../config/BrandContext';

import { statusColors, seriesColor } from '../theme/brandColors';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Result cell: golden IDs and `<module>_id` UUIDs become links to the record. */
function ResultValue({ column, value }: { column: string; value: unknown }) {
  const col = column.toLowerCase();
  const s = String(value);
  if (col === 'golden_id') return <GoldenChip goldenId={s} />;
  const m = col.match(/^(\w+?)_id$/);
  if (m && UUID_RE.test(s)) return <RecordLink type={m[1]} id={s} />;
  return <>{s}</>;
}

interface ContentBlock {
  type: string;
  text?: string;
  statement?: string;
  suggestions?: string[];
  results?: Record<string, unknown>[];
  error?: string;
}

interface ChatMessage {
  role: 'user' | 'analyst';
  content: ContentBlock[];
  timestamp: Date;
}

/** Sample questions built from the enabled modules, which are the ones in the semantic view. */
function exampleQuestions(modules: ModuleConfig[]): string[] {
  const out: string[] = [];
  for (const m of modules.filter(x => x.enabled).sort((x, y) => x.order - y.order)) {
    const name = localized(m.label, m.labels).toLowerCase();
    const has = (f: string) => m.fields.some(x => x.name === f && x.active !== false);
    out.push(tr('analyst.qByStage', { module: name }));
    if (has('country_code')) out.push(tr('analyst.qByCountry', { module: name }));
    const dim = m.filters.find(f => f.field !== 'lifecycle_stage' && f.field !== 'country_code' && has(f.field));
    if (dim) out.push(tr('analyst.qDqByField', { module: name, field: dim.label.toLowerCase() }));
    out.push(tr('analyst.qLowestDq', { module: name }));
  }
  out.push(tr('analyst.qWorkflows'), tr('analyst.qMatches'));
  return out;
}

export default function Analyst() {
  const brand = useBrand();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const fg = theme.palette.text.primary;
  const fgMuted = theme.palette.text.secondary;
  const dividerColor = theme.palette.divider;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [effectiveRole, setEffectiveRole] = useState<string | null>(null);
  const { currentUser } = useUser();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: ChatMessage = { role: 'user', content: [{ type: 'text', text }], timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    const apiMessages = [...messages, userMsg].map(m => ({
      role: m.role,
      content: m.content.map(b => {
        if (b.type === 'text') return { type: 'text', text: b.text };
        if (b.type === 'sql') return { type: 'sql', statement: b.statement };
        if (b.type === 'suggestions') return { type: 'suggestions', suggestions: b.suggestions };
        return b;
      }),
    }));

    try {
      const res = await fetch('/api/analyst/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mdm-user': getCurrentUserEmail() },
        body: JSON.stringify({ messages: apiMessages }),
      });
      const body = await res.json();
      if (body.effective_role) setEffectiveRole(body.effective_role);

      if (!res.ok) {
        setMessages(prev => [...prev, { role: 'analyst', content: [{ type: 'text', text: `Error: ${body.detail || body.error || res.statusText}` }], timestamp: new Date() }]);
      } else if (body.message?.content) {
        setMessages(prev => [...prev, { role: 'analyst', content: body.message.content, timestamp: new Date() }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'analyst', content: [{ type: 'text', text: `Network error: ${e}` }], timestamp: new Date() }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text); };

  const renderResultTable = (rows: Record<string, unknown>[]) => {
    if (!rows || rows.length === 0) return <Typography variant="caption" sx={{ color: fgMuted }}>{tr('analyst.noResults')}</Typography>;
    const cols = Object.keys(rows[0]);
    return (
      <TableContainer component={Paper} sx={{ bgcolor: isDark ? alpha('#000', 0.3) : alpha(brand.palette.primary, 0.03), maxHeight: 320, mt: 1, borderRadius: 1.5, border: `1px solid ${dividerColor}` }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {cols.map(c => <TableCell key={c} sx={{ bgcolor: alpha(brand.palette.primary, 0.15), color: brand.palette.accent, fontWeight: 600, fontSize: '0.7rem', borderBottom: `1px solid ${dividerColor}`, whiteSpace: 'nowrap' }}>{c}</TableCell>)}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.slice(0, 50).map((row, i) => (
              <TableRow key={i} sx={{ '&:hover': { bgcolor: alpha(fg, 0.02) } }}>
                {cols.map(c => <TableCell key={c} sx={{ fontSize: '0.75rem', borderBottom: `1px solid ${dividerColor}`, color: fg, whiteSpace: 'nowrap' }}>{row[c] == null ? '-' : <ResultValue column={c} value={row[c]} />}</TableCell>)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length > 50 && <Typography variant="caption" sx={{ p: 1, display: 'block', color: fgMuted }}>{tr('analyst.showing50OfLengthRows', { length: rows.length })}</Typography>}
      </TableContainer>
    );
  };

  const renderBlock = (block: ContentBlock, idx: number) => {
    if (block.type === 'text' && block.text) {
      return <Typography key={idx} variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, color: fg }}>{block.text}</Typography>;
    }
    if (block.type === 'sql' && block.statement) {
      return (
        <Box key={idx} sx={{ mt: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <StorageIcon sx={{ fontSize: 14, color: brand.palette.accent }} />
            <Typography variant="caption" sx={{ color: brand.palette.accent, fontWeight: 600 }}>{tr('analyst.generatedSql')}</Typography>
            <IconButton size="small" onClick={() => copyToClipboard(block.statement!)} sx={{ ml: 'auto', color: fgMuted, '&:hover': { color: fg } }}>
              <ContentCopyIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
          <Box sx={{ bgcolor: isDark ? alpha('#000', 0.4) : alpha(brand.palette.primary, 0.05), borderRadius: 1.5, p: 1.5, border: `1px solid ${alpha(brand.palette.accent, 0.15)}`, fontFamily: 'monospace', fontSize: '0.75rem', color: theme.palette.text.primary, overflow: 'auto', maxHeight: 200, whiteSpace: 'pre-wrap' }}>
            {block.statement}
          </Box>
          {block.error && <Typography variant="caption" sx={{ color: statusColors().error, mt: 0.5 }}>{tr('analyst.executionErrorError', { error: block.error })}</Typography>}
          {block.results && renderResultTable(block.results)}
        </Box>
      );
    }
    if (block.type === 'suggestions' && block.suggestions) {
      return (
        <Box key={idx} sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1.5 }}>
          {block.suggestions.map((s, i) => (
            <Chip key={i} label={s} size="small" variant="outlined" clickable onClick={() => sendMessage(s)}
              sx={{ fontSize: '0.7rem', color: brand.palette.accent, borderColor: alpha(brand.palette.accent, 0.3), '&:hover': { bgcolor: alpha(brand.palette.accent, 0.1) } }} />
          ))}
        </Box>
      );
    }
    return null;
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <AutoAwesomeIcon sx={{ color: seriesColor(1), fontSize: 28 }} />
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>{tr('analyst.cortexAnalyst')}</Typography>
          <Typography variant="caption" sx={{ color: fgMuted }}>{tr('analyst.askQuestionsAboutYourMdm')}</Typography>
        </Box>
        {effectiveRole && (
          <Chip icon={<ShieldIcon sx={{ fontSize: 14 }} />} label={`${effectiveRole}${currentUser?.country_scope ? ' — ' + currentUser.country_scope.join(', ') : ''}`} size="small" variant="outlined" sx={{ fontSize: '0.7rem', color: effectiveRole.includes('ADMIN') ? statusColors().success : effectiveRole.includes('STEWARD') ? statusColors().warning : statusColors().neutral, borderColor: effectiveRole.includes('ADMIN') ? statusColors().success : effectiveRole.includes('STEWARD') ? statusColors().warning : statusColors().neutral }} />
        )}
      </Box>

      <Card sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
          {messages.length === 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 3 }}>
              <AutoAwesomeIcon sx={{ fontSize: 48, color: alpha(seriesColor(1), 0.3) }} />
              <Typography variant="h6" sx={{ color: fgMuted }}>{tr('analyst.askAnythingAboutYourMdm')}</Typography>
              <Typography variant="caption" sx={{ color: fgMuted, maxWidth: 500, textAlign: 'center' }}>
                {tr('analyst.cortexAnalystTranslatesYourQuestions')}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center', maxWidth: 700 }}>
                {exampleQuestions(brand.modules || []).map((q, i) => (
                  <Chip key={i} label={q} size="small" variant="outlined" clickable onClick={() => sendMessage(q)}
                    sx={{ fontSize: '0.7rem', color: fgMuted, borderColor: dividerColor, '&:hover': { bgcolor: alpha(seriesColor(1), 0.08), borderColor: alpha(seriesColor(1), 0.3) } }} />
                ))}
              </Box>
            </Box>
          )}

          {messages.map((msg, i) => (
            <Box key={i} sx={{ mb: 2, display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <Box sx={{
                maxWidth: msg.role === 'user' ? '60%' : '90%',
                p: 2, borderRadius: 2,
                bgcolor: msg.role === 'user' ? alpha(brand.palette.primary, 0.25) : alpha(fg, 0.03),
                border: `1px solid ${msg.role === 'user' ? alpha(brand.palette.primary, 0.3) : dividerColor}`,
              }}>
                {msg.role === 'analyst' && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                    <AutoAwesomeIcon sx={{ fontSize: 14, color: seriesColor(1) }} />
                    <Typography variant="caption" sx={{ color: seriesColor(1), fontWeight: 600 }}>{tr('analyst.cortexAnalyst')}</Typography>
                  </Box>
                )}
                {msg.content.map(renderBlock)}
              </Box>
            </Box>
          ))}

          {loading && (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2, p: 2 }}>
              <CircularProgress size={16} sx={{ color: seriesColor(1) }} />
              <Typography variant="caption" sx={{ color: fgMuted }}>{tr('analyst.analyzingYourQuestion')}</Typography>
            </Box>
          )}
          <div ref={bottomRef} />
        </Box>

        <Box sx={{ p: 2, borderTop: `1px solid ${dividerColor}`, display: 'flex', gap: 1 }}>
          <TextField
            inputRef={inputRef}
            fullWidth size="small" autoFocus
            placeholder={tr('analyst.askAQuestionAboutYour')}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
            disabled={loading}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2, fontSize: '0.85rem' } }}
          />
          <IconButton onClick={() => sendMessage(input)} disabled={loading || !input.trim()} sx={{ bgcolor: alpha(seriesColor(1), 0.15), color: seriesColor(1), '&:hover': { bgcolor: alpha(seriesColor(1), 0.25) }, '&.Mui-disabled': { color: alpha(fg, 0.1) } }}>
            <SendIcon fontSize="small" />
          </IconButton>
        </Box>
      </Card>
    </Box>
  );
}

import { useState, useCallback } from 'react';
import {
  TablePagination,
  Box, Card, Table, TableHead, TableRow, TableCell, TableBody, Button, Chip, Typography, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, FormControlLabel, Checkbox, Alert,
} from '@mui/material';
import UndoIcon from '@mui/icons-material/Undo';
import { matchApi } from '../api/client';
import type { MergeHistoryEntry } from '../types/models';
import { useUser } from '../context/UserContext';
import { GoldenChip, RecordLink, UserLink } from './common/Links';
import { tr } from '../i18n';
import { PAGE_SIZES, useServerList } from './common/useServerList';

const NO_QUERY = {};
import i18n from '../i18n';

import { formatDate } from './common/format';
/** Merge history with an Unmerge action (stewards and admins). */
export default function MergeHistory({ onChanged, notify }: {
  onChanged: () => void;
  notify: (msg: string, severity: 'success' | 'error' | 'warning') => void;
}) {
  const { canEdit, isAdmin } = useUser();
  const onListError = useCallback((e: Error) => notify(tr('mergeHistory.failedToLoadMergeHistory', { v0: e.message }), 'error'), [notify]);
  const list = useServerList(matchApi.mergesPage, NO_QUERY, { prefix: 'mh_', onError: onListError });
  const { rows, loading } = list;
  const [confirm, setConfirm] = useState<MergeHistoryEntry | null>(null);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = list.reload;

  const unmerge = async () => {
    if (!confirm) return;
    try {
      setBusy(true); setError(null);
      const r = await matchApi.unmerge(confirm.id, force);
      const moved = r.moved_back.children + r.moved_back.workflows + r.moved_back.comments;
      notify(tr('mergeHistory.unmergedMergedNameV1', { merged_name: confirm.merged_name, v1: moved ? tr('mergeHistory.movedBack', { count: moved }) : '' }), 'success');
      setConfirm(null); setForce(false);
      await load(); onChanged();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  if (loading && !rows.length) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>;
  if (!rows.length) return <Card sx={{ p: 4, textAlign: 'center' }}><Typography color="text.secondary">{tr('mergeHistory.noMergesYet')}</Typography></Card>;

  return (
    <Card>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{tr('mergeHistory.merged')}</TableCell><TableCell>{tr('mergeHistory.intoSurvivor')}</TableCell><TableCell>{tr('mergeHistory.type')}</TableCell>
            <TableCell>{tr('mergeHistory.by')}</TableCell><TableCell>{tr('mergeHistory.when')}</TableCell><TableCell>{tr('mergeHistory.status')}</TableCell><TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(r => (
            <TableRow key={r.id} hover>
              <TableCell>{r.merged_name}</TableCell>
              <TableCell><RecordLink type={r.entity_type} id={r.survivor_id}>{r.survivor_name}</RecordLink><Box sx={{ mt: 0.5 }}><GoldenChip goldenId={r.golden_id} /></Box></TableCell>
              <TableCell><Chip size="small" label={r.entity_type} /></TableCell>
              <TableCell><UserLink email={r.merged_by} /></TableCell>
              <TableCell>{formatDate(r.merged_at, true)}</TableCell>
              <TableCell>
                {r.unmerged_at
                  ? <Chip size="small" color="warning" label={tr('mergeHistory.unmergedOn', { date: new Date(r.unmerged_at).toLocaleDateString(i18n.language) })} />
                  : <Chip size="small" color="success" label={tr('mergeHistory.merged')} />}
              </TableCell>
              <TableCell align="right">
                {canEdit && !r.unmerged_at && (
                  <Button size="small" startIcon={<UndoIcon />} disabled={!r.can_unmerge}
                    title={r.can_unmerge ? tr('mergeHistory.restoreBothRecords') : 'This merge predates unmerge support'}
                    onClick={() => { setConfirm(r); setForce(false); setError(null); }}>{tr('mergeHistory.unmerge')}</Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {list.pager.total > list.pager.size && (
        <TablePagination component="div" count={list.pager.total} page={list.pager.page} rowsPerPage={list.pager.size}
          rowsPerPageOptions={PAGE_SIZES} onPageChange={(_, p) => list.pager.setPage(p)}
          onRowsPerPageChange={e => list.pager.setSize(Number(e.target.value))} />
      )}

      <Dialog open={!!confirm} onClose={() => setConfirm(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('mergeHistory.unmerge')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            <strong>{confirm?.merged_name}</strong> {tr('mergeHistory.isRestoredWithItsOwn')} <strong>{confirm?.survivor_name}</strong> gets
            back its pre-merge values, and children, open workflows and comments moved by the merge return to the restored record.
          </Typography>
          {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
          {isAdmin && (
            <FormControlLabel control={<Checkbox checked={force} onChange={e => setForce(e.target.checked)} />}
              label={tr('mergeHistory.forceEvenIfTheSurviving')} />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)} disabled={busy}>{tr('mergeHistory.cancel')}</Button>
          <Button variant="contained" color="warning" onClick={unmerge} disabled={busy}
            startIcon={busy ? <CircularProgress size={16} /> : <UndoIcon />}>{tr('mergeHistory.unmerge')}</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

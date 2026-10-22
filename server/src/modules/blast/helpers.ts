import type { BlastDegradedReason, BlastRadiusResponse } from '@devdigest/shared';
import type { BlastResult, IndexState } from '../repo-intel/types.js';

/** Pure mapping of a repo-intel `BlastResult` to the API contract. No I/O. */

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function deriveDegraded(i: {
  repoIntelEnabled: boolean;
  state: IndexState;
  result: BlastResult;
}): { degraded: boolean; reason: BlastDegradedReason | null } {
  if (!i.repoIntelEnabled) return { degraded: true, reason: 'flag_off' };
  if (i.state.degraded) return { degraded: true, reason: i.state.degradedReason ?? 'index_failed' };
  if (i.state.status === 'partial') return { degraded: true, reason: 'index_partial' };
  if (i.result.degraded) return { degraded: true, reason: i.result.reason ?? 'no_data' };
  return { degraded: false, reason: null };
}

export function toBlastRadiusResponse(i: {
  prId: string;
  result: BlastResult;
  state: IndexState;
  repoIntelEnabled: boolean;
}): BlastRadiusResponse {
  const { result, state } = i;
  const { degraded, reason } = deriveDegraded(i);

  const seenSymbols = new Set<string>();
  const changed_symbols: BlastRadiusResponse['changed_symbols'] = [];
  for (const s of result.changedSymbols) {
    const key = `${s.name}\u0000${s.file}`;
    if (seenSymbols.has(key)) continue;
    seenSymbols.add(key);
    changed_symbols.push({ name: s.name, file: s.file, kind: s.kind });
  }

  const bySymbol = new Map<string, BlastResult['callers']>();
  for (const row of result.callers) {
    const list = bySymbol.get(row.viaSymbol) ?? [];
    list.push(row);
    bySymbol.set(row.viaSymbol, list);
  }

  const allEndpoints = new Set<string>();
  const allCrons = new Set<string>();
  const downstream: BlastRadiusResponse['downstream'] = [];
  for (const [symbol, rows] of bySymbol) {
    const sorted = [...rows].sort((a, b) => b.rank - a.rank || cmp(a.file, b.file) || a.line - b.line);
    const seen = new Set<string>();
    const callers: BlastRadiusResponse['downstream'][number]['callers'] = [];
    for (const r of sorted) {
      const key = `${r.file}\u0000${r.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      callers.push({ name: r.symbol, file: r.file, line: r.line });
    }
    const endpoints = new Set<string>();
    const crons = new Set<string>();
    for (const c of callers) {
      const facts = result.factsByFile?.[c.file];
      facts?.endpoints.forEach((e) => endpoints.add(e));
      facts?.crons.forEach((e) => crons.add(e));
    }
    endpoints.forEach((e) => allEndpoints.add(e));
    crons.forEach((e) => allCrons.add(e));
    downstream.push({
      symbol,
      callers,
      endpoints_affected: [...endpoints].sort(cmp),
      crons_affected: [...crons].sort(cmp),
    });
  }
  downstream.sort((a, b) => b.callers.length - a.callers.length || cmp(a.symbol, b.symbol));

  const stats = {
    symbols: changed_symbols.length,
    callers: downstream.reduce((n, d) => n + d.callers.length, 0),
    endpoints: allEndpoints.size,
    crons: allCrons.size,
  };
  const summary =
    `${stats.symbols} changed symbols · ${stats.callers} callers · ${stats.endpoints} endpoints · ${stats.crons} crons` +
    (degraded ? ` (index degraded: ${reason})` : '');

  return {
    pr_id: i.prId,
    index_sha: state.lastIndexedSha || null,
    changed_symbols,
    downstream,
    summary,
    stats,
    degraded,
    degraded_reason: reason,
  };
}

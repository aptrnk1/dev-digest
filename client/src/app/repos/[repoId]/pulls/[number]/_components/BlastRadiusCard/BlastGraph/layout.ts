/* Pure layout for the blast-radius graph: three columns (changed symbols,
   callers, endpoints/crons). No DOM, so it is unit-testable on its own.
   The contract carries endpoints/crons per *symbol*, so those edges are
   dashed symbol → endpoint/cron; caller → endpoint edges are never invented. */
import type { BlastRadiusResponse } from "@devdigest/shared";

export const MAX_GRAPH_CALLERS = 30;

export type GraphNodeKind = "symbol" | "caller" | "endpoint" | "cron";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  file?: string;
  line?: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  dashed: boolean;
}

export interface BlastGraphLayout {
  width: number;
  height: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  hiddenCallers: number;
}

export interface LayoutOptions {
  maxCallers?: number;
}

const PAD = 12;
const NODE_H = 32;
const ROW_GAP = 12;
const COL_W = { symbol: 180, caller: 220, affected: 200 } as const;
const COL_GAP = 70;
const COL_X = {
  symbol: PAD,
  caller: PAD + COL_W.symbol + COL_GAP,
  affected: PAD + COL_W.symbol + COL_GAP + COL_W.caller + COL_GAP,
} as const;
const WIDTH = COL_X.affected + COL_W.affected + PAD;

type Downstream = BlastRadiusResponse["downstream"];

export function layoutBlastGraph(downstream: Downstream, opts: LayoutOptions = {}): BlastGraphLayout {
  const maxCallers = opts.maxCallers ?? MAX_GRAPH_CALLERS;
  const symbols = new Map<string, GraphNode>();
  const callers = new Map<string, GraphNode>();
  const affected = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const seenHidden = new Set<string>();

  const addEdge = (from: string, to: string, dashed: boolean) => {
    const key = `${from}>${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to, dashed });
  };
  const node = (id: string, kind: GraphNodeKind, label: string, w: number, x: number): GraphNode => ({
    id, kind, label, x, y: 0, w, h: NODE_H,
  });

  for (const d of downstream) {
    const sid = `s:${d.symbol}`;
    if (!symbols.has(sid)) symbols.set(sid, node(sid, "symbol", d.symbol, COL_W.symbol, COL_X.symbol));

    for (const c of d.callers) {
      const cid = `c:${c.name}|${c.file}`;
      if (!callers.has(cid)) {
        if (callers.size >= maxCallers) {
          seenHidden.add(cid);
          continue;
        }
        callers.set(cid, { ...node(cid, "caller", c.name, COL_W.caller, COL_X.caller), file: c.file, line: c.line });
      }
      addEdge(sid, cid, false);
    }
    for (const e of d.endpoints_affected) {
      const id = `e:${e}`;
      if (!affected.has(id)) affected.set(id, node(id, "endpoint", e, COL_W.affected, COL_X.affected));
      addEdge(sid, id, true);
    }
    for (const k of d.crons_affected) {
      const id = `k:${k}`;
      if (!affected.has(id)) affected.set(id, node(id, "cron", k, COL_W.affected, COL_X.affected));
      addEdge(sid, id, true);
    }
  }

  const columns = [[...symbols.values()], [...callers.values()], [...affected.values()]];
  const rows = Math.max(0, ...columns.map((c) => c.length));
  const inner = rows === 0 ? 0 : rows * NODE_H + (rows - 1) * ROW_GAP;
  for (const col of columns) {
    const colH = col.length === 0 ? 0 : col.length * NODE_H + (col.length - 1) * ROW_GAP;
    const top = PAD + (inner - colH) / 2;
    col.forEach((n, i) => {
      n.y = top + i * (NODE_H + ROW_GAP);
    });
  }

  const nodes = columns.flat();
  return {
    width: WIDTH,
    height: nodes.length === 0 ? 0 : inner + PAD * 2,
    nodes,
    edges,
    hiddenCallers: seenHidden.size,
  };
}

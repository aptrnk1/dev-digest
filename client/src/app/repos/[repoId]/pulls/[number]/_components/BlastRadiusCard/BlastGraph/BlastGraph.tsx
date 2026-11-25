/* BlastGraph — hand-rolled SVG node-link view of the blast radius:
   changed symbol → callers (solid), changed symbol ⇢ endpoints/crons (dashed,
   affected via that symbol's callers). Scales down via viewBox. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { layoutBlastGraph, type GraphNode } from "./layout";
import { NODE_STYLE, s } from "./styles";

interface BlastGraphProps {
  downstream: BlastRadiusResponse["downstream"];
  repoFullName: string | null;
  sha: string | null;
}

const MAX_LABEL_CHARS = 24;

function truncate(label: string): string {
  return label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label;
}

export function BlastGraph({ downstream, repoFullName, sha }: BlastGraphProps) {
  const t = useTranslations("blast");
  const layout = React.useMemo(() => layoutBlastGraph(downstream), [downstream]);

  if (layout.nodes.length === 0) return <div style={s.muted}>{t("graph.empty")}</div>;

  const byId = new Map(layout.nodes.map((n) => [n.id, n]));

  const renderNode = (n: GraphNode) => {
    const st = NODE_STYLE[n.kind];
    const body = (
      <g>
        <title>{n.file ? `${n.label} — ${n.file}:${n.line}` : n.label}</title>
        <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={6} fill={st.fill} stroke={st.stroke} strokeWidth={1.5} />
        <text x={n.x + 10} y={n.y + n.h / 2} dominantBaseline="central" className="mono" style={s.label}>
          {truncate(n.label)}
        </text>
      </g>
    );
    if (n.kind === "caller" && n.file && repoFullName && sha) {
      return (
        <a
          key={n.id}
          href={githubBlobUrl(repoFullName, sha, n.file, n.line)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {body}
        </a>
      );
    }
    return <React.Fragment key={n.id}>{body}</React.Fragment>;
  };

  return (
    <div style={s.wrap}>
      <svg
        role="img"
        aria-label={t("graph.ariaLabel")}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={s.svg}
      >
        {layout.edges.map((e) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + a.w;
          const y1 = a.y + a.h / 2;
          const x2 = b.x;
          const y2 = b.y + b.h / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={`${e.from}>${e.to}`}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              style={e.dashed ? { ...s.edge, ...s.edgeDashed } : s.edge}
            />
          );
        })}
        {layout.nodes.map(renderNode)}
      </svg>
      {layout.hiddenCallers > 0 && <div style={s.muted}>{t("graph.more", { count: layout.hiddenCallers })}</div>}
      <div style={s.legend}>
        <span style={s.legendItem}>
          <span style={{ ...s.swatch, ...NODE_STYLE.symbol, border: `1.5px solid ${NODE_STYLE.symbol.stroke}`, background: NODE_STYLE.symbol.fill }} />
          {t("graph.legend.symbol")}
        </span>
        <span style={s.legendItem}>
          <span style={{ ...s.swatch, border: `1.5px solid ${NODE_STYLE.caller.stroke}`, background: NODE_STYLE.caller.fill }} />
          {t("graph.legend.callers")}
        </span>
        <span style={s.legendItem}>
          <span style={{ ...s.swatch, border: `1.5px solid ${NODE_STYLE.endpoint.stroke}`, background: NODE_STYLE.endpoint.fill }} />
          {t("graph.legend.affected")}
        </span>
      </div>
    </div>
  );
}

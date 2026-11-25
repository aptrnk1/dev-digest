/* BlastTree — the list view of the blast radius: per changed symbol its callers
   (GitHub file:line links) and the endpoints/crons depending on it. Each symbol
   row collapses its callers and chips. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import { Icon } from "@devdigest/ui";
import { githubBlobUrl } from "@/lib/github-urls";
import { s } from "./styles";

interface BlastTreeProps {
  downstream: BlastRadiusResponse["downstream"];
  repoFullName: string | null;
  sha: string | null;
}

export function BlastTree({ downstream, repoFullName, sha }: BlastTreeProps) {
  const t = useTranslations("blast");
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set());

  const toggle = (symbol: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(symbol)) next.add(symbol);
      return next;
    });

  return (
    <>
      {downstream.map((d) => {
        const open = !collapsed.has(d.symbol);
        const Chevron = open ? Icon.ChevronDown : Icon.ChevronRight;
        return (
          <div key={d.symbol} style={s.group}>
            <div style={s.symbolRow}>
              <button
                type="button"
                style={s.symbolToggle}
                aria-expanded={open}
                aria-label={t("tree.toggle", { symbol: d.symbol })}
                onClick={() => toggle(d.symbol)}
              >
                <Chevron size={14} aria-hidden />
                <span className="mono">{d.symbol}</span>
              </button>
              <span style={s.muted}>{t("callerCount", { count: d.callers.length })}</span>
            </div>
            {open &&
              d.callers.map((c) => {
                const label = `${c.file}:${c.line}`;
                return (
                  <div key={label} style={s.callerRow}>
                    <Icon.CornerDownRight size={12} aria-hidden />
                    {repoFullName && sha ? (
                      <a
                        className="mono"
                        style={s.link}
                        href={githubBlobUrl(repoFullName, sha, c.file, c.line)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {label}
                      </a>
                    ) : (
                      <span className="mono">{label}</span>
                    )}
                    <span>{c.name}</span>
                  </div>
                );
              })}
            {open && (d.endpoints_affected.length > 0 || d.crons_affected.length > 0) && (
              <div style={s.chips}>
                {d.endpoints_affected.map((e) => (
                  <span key={`e-${e}`} style={s.endpointChip}>
                    <Icon.Globe size={12} aria-hidden />
                    {e}
                  </span>
                ))}
                {d.crons_affected.map((c) => (
                  <span key={`c-${c}`} style={s.cronChip}>
                    <Icon.Clock size={12} aria-hidden />
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

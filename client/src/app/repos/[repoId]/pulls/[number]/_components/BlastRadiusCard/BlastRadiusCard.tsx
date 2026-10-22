/* BlastRadiusCard — what else the diff can touch: stats, changed symbols with
   their callers (GitHub file:line links) and the endpoints/crons depending on
   them. Sits between Intent and Description on the Overview tab. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import { useBlastRadius } from "@/lib/hooks/blast";
import { useResyncRepoIntel } from "@/lib/hooks/repo-intel";
import { githubBlobUrl } from "@/lib/github-urls";
import { DEGRADED_MESSAGE_KEY, REBUILD_HELPS } from "./constants";
import { s } from "./styles";

interface BlastRadiusCardProps {
  prId: string | null;
  repoId: string;
  repoFullName: string | null;
  headSha: string | null;
}

export function BlastRadiusCard({ prId, repoId, repoFullName, headSha }: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const { data, isLoading, isError, refetch } = useBlastRadius(prId);
  const resync = useResyncRepoIntel(repoId);
  const [started, setStarted] = React.useState(false);

  if (isLoading) {
    return (
      <section data-testid="blast-loading">
        <SectionLabel icon="Zap">{t("title")}</SectionLabel>
        <Skeleton height={120} />
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section>
        <SectionLabel icon="Zap">{t("title")}</SectionLabel>
        <ErrorState title={t("error.title")} body={t("error.body")} onRetry={() => refetch()} />
      </section>
    );
  }

  const sha = data.index_sha ?? headSha;
  const reason = data.degraded ? data.degraded_reason : null;
  const downstream = data.downstream.filter((d) => d.callers.length > 0);
  const stats = [
    { key: "symbols", value: data.stats.symbols, label: t("stat.symbols") },
    { key: "callers", value: data.stats.callers, label: t("stat.callers") },
    { key: "endpoints", value: data.stats.endpoints, label: t("stat.endpoints") },
    { key: "crons", value: data.stats.crons, label: t("stat.crons") },
  ];

  return (
    <section>
      <SectionLabel icon="Zap">{t("title")}</SectionLabel>
      <div style={s.card}>
        {reason && (
          <div style={s.banner} role="status">
            <span>{t(DEGRADED_MESSAGE_KEY[reason])}</span>
            {REBUILD_HELPS[reason] &&
              (started ? (
                <span>{t("degraded.rebuildStarted")}</span>
              ) : (
                <Button
                  kind="secondary"
                  size="sm"
                  icon="RefreshCw"
                  disabled={resync.isPending}
                  onClick={() => resync.mutate(undefined, { onSuccess: () => setStarted(true) })}
                >
                  {t("degraded.rebuild")}
                </Button>
              ))}
          </div>
        )}

        <div style={s.stats}>
          {stats.map((st) => (
            <div key={st.key} style={s.stat}>
              <span style={s.statValue}>{st.value}</span>
              <span style={s.statLabel}>{st.label}</span>
            </div>
          ))}
        </div>

        {data.changed_symbols.length === 0 && !data.degraded && <div style={s.muted}>{t("empty")}</div>}

        {data.changed_symbols.length > 0 && downstream.length === 0 && (
          <div style={s.muted}>{t("noDownstream", { count: data.changed_symbols.length })}</div>
        )}

        {downstream.map((d) => (
          <div key={d.symbol} style={s.group}>
            <div style={s.symbolRow}>
              <span className="mono">{d.symbol}</span>
              <span style={s.muted}>{t("callerCount", { count: d.callers.length })}</span>
            </div>
            {d.callers.map((c) => {
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
            {(d.endpoints_affected.length > 0 || d.crons_affected.length > 0) && (
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
        ))}
      </div>
    </section>
  );
}

/* BlastRadiusCard — what else the diff can touch: stats, changed symbols with
   their callers (GitHub file:line links) and the endpoints/crons depending on
   them. Sits between Intent and Description on the Overview tab. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ErrorState, SectionLabel, Skeleton } from "@devdigest/ui";
import { useBlastRadius } from "@/lib/hooks/blast";
import { useResyncRepoIntel } from "@/lib/hooks/repo-intel";
import { BlastGraph } from "./BlastGraph";
import { BlastTree } from "./BlastTree";
import { DEGRADED_MESSAGE_KEY, REBUILD_HELPS, VIEWS, type BlastView } from "./constants";
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
  const [view, setView] = React.useState<BlastView>("tree");

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

        <div style={s.statsRow}>
          <div style={s.stats}>
            {stats.map((st) => (
              <div key={st.key} style={s.stat}>
                <span style={s.statValue}>{st.value}</span>
                <span style={s.statLabel}>{st.label}</span>
              </div>
            ))}
          </div>
          {downstream.length > 0 && (
            <div style={s.segmented} role="group">
              {VIEWS.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  style={view === v ? s.segmentActive : s.segment}
                  onClick={() => setView(v)}
                >
                  {t(`view.${v}`)}
                </button>
              ))}
            </div>
          )}
        </div>

        {data.changed_symbols.length === 0 && !data.degraded && <div style={s.muted}>{t("empty")}</div>}

        {data.changed_symbols.length > 0 && downstream.length === 0 && (
          <div style={s.muted}>{t("noDownstream", { count: data.changed_symbols.length })}</div>
        )}

        {downstream.length > 0 &&
          (view === "tree" ? (
            <BlastTree downstream={downstream} repoFullName={repoFullName} sha={sha} />
          ) : (
            <BlastGraph downstream={downstream} repoFullName={repoFullName} sha={sha} />
          ))}
      </div>
    </section>
  );
}

/* BriefCard — the PR Brief block on Overview: LLM summary of the PR plus
   provenance lines (missing inputs, outdated intent). Opening only reads the
   stored brief; generating is always an explicit click (no auto-generation). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, SectionLabel, Skeleton } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { useGenerateBrief, usePrBrief } from "@/lib/hooks/brief";
import { s } from "./styles";

// After a 409 (another generation is running) re-read the brief every
// POLL_MS until it changes, for at most POLL_MAX_MS.
const POLL_MS = 5_000;
const POLL_MAX_MS = 100_000;

export function BriefCard({ prId }: { prId: string | null }) {
  const t = useTranslations("brief");
  // `from` = generated_at of the brief shown when the 409 arrived.
  const [pollFrom, setPollFrom] = React.useState<{ from: string | null } | null>(null);
  const { data, isLoading, isError, refetch } = usePrBrief(prId, pollFrom ? POLL_MS : false);
  const generate = useGenerateBrief(prId);
  const generatedAt = data?.brief?.generated_at ?? null;

  const { reset } = generate;
  const polling = pollFrom !== null;

  // Polling over (new brief seen, window ended, PR changed): drop the poll
  // state and the stale "in progress" alert together.
  const stopPolling = React.useCallback(() => {
    setPollFrom(null);
    reset();
  }, [reset]);

  React.useEffect(() => {
    stopPolling();
  }, [prId, stopPolling]);
  React.useEffect(() => {
    if (pollFrom && generatedAt !== pollFrom.from) stopPolling();
  }, [pollFrom, generatedAt, stopPolling]);
  React.useEffect(() => {
    if (!polling) return;
    const id = setTimeout(stopPolling, POLL_MAX_MS);
    return () => clearTimeout(id);
  }, [polling, stopPolling]);

  const busy = generate.isPending || polling;
  const run = () =>
    generate.mutate(undefined, {
      onError: (e) => {
        if (e instanceof ApiError && e.code === "brief_in_progress") {
          setPollFrom({ from: generatedAt });
          void refetch();
        }
      },
    });

  if (isLoading) {
    return (
      <section data-testid="brief-loading">
        <SectionLabel icon="FileText">{t("title")}</SectionLabel>
        <Skeleton height={120} />
      </section>
    );
  }

  // A failed background refetch must not hide a brief we already have.
  if (isError && !data) {
    return (
      <section>
        <SectionLabel icon="FileText">{t("title")}</SectionLabel>
        <ErrorState title={t("error.title")} body={t("error.body")} onRetry={() => refetch()} />
      </section>
    );
  }

  const brief = data?.brief ?? null;
  const stale = data?.stale === true;

  const err = generate.error;
  const errorKey = !generate.isError
    ? null
    : err instanceof ApiError && err.code === "llm_not_configured"
      ? "generateError.notConfigured"
      : err instanceof ApiError && err.code === "brief_in_progress"
        ? "generateError.inProgress"
        : "generateError.generic";
  const errorLine = errorKey && (
    <div role="alert" style={s.error}>
      {t(errorKey)}
    </div>
  );

  if (!brief) {
    return (
      <section>
        <SectionLabel icon="FileText">{t("title")}</SectionLabel>
        <div style={s.card}>
          <div style={s.empty}>
            <div style={s.emptyTitle}>{t("unavailable")}</div>
            <div style={s.note}>{t("unavailableHint")}</div>
            <Button
              kind="primary"
              icon="Sparkles"
              loading={busy}
              onClick={run}
            >
              {busy ? t("generating") : t("generate")}
            </Button>
            {errorLine}
          </div>
        </div>
      </section>
    );
  }

  const missing = brief.missing_inputs.map((k) => t(`input.${k}`)).join(", ");
  return (
    <section>
      <SectionLabel
        icon="FileText"
        right={
          <div style={s.right}>
            {stale && (
              <span title={t("staleHint")}>
                <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
                  {t("stale")}
                </Badge>
              </span>
            )}
            <Button
              kind="secondary"
              size="sm"
              icon="RefreshCw"
              loading={busy}
              onClick={run}
            >
              {busy ? t("generating") : t("refresh")}
            </Button>
          </div>
        }
      >
        {t("title")}
      </SectionLabel>
      <div style={s.card}>
        <p style={s.summary}>{brief.summary}</p>
        {brief.missing_inputs.length > 0 && <div style={s.note}>{t("missingInputs", { list: missing })}</div>}
        {brief.intent_stale && <div style={s.warn}>{t("intentStale")}</div>}
        {errorLine}
      </div>
    </section>
  );
}

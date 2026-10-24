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

export function BriefCard({ prId }: { prId: string | null }) {
  const t = useTranslations("brief");
  const { data, isLoading, isError, refetch } = usePrBrief(prId);
  const generate = useGenerateBrief(prId);

  if (isLoading) {
    return (
      <section data-testid="brief-loading">
        <SectionLabel icon="FileText">{t("title")}</SectionLabel>
        <Skeleton height={120} />
      </section>
    );
  }

  if (isError) {
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
              loading={generate.isPending}
              onClick={() => generate.mutate()}
            >
              {generate.isPending ? t("generating") : t("generate")}
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
              loading={generate.isPending}
              onClick={() => generate.mutate()}
            >
              {generate.isPending ? t("generating") : t("refresh")}
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

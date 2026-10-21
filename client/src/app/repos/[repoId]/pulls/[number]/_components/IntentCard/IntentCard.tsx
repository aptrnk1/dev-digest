/* IntentCard — what the PR is trying to do (derived from spec/ticket/description):
   quote, scope, risk areas, confidence + provenance. Sits above Description. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Chip, EmptyState, ErrorState, SectionLabel, Skeleton } from "@devdigest/ui";
import { useDeriveIntent, usePrIntent } from "@/lib/hooks/intent";
import { RISK_ICON } from "./constants";
import { s } from "./styles";

const CONFIDENCE_COLOR = {
  high: "var(--ok)",
  medium: "var(--warn)",
  low: "var(--crit)",
} as const;

export function IntentCard({ prId }: { prId: string | null }) {
  const t = useTranslations("brief.intent");
  const { data, isLoading, isError, refetch } = usePrIntent(prId);
  const derive = useDeriveIntent(prId);

  if (isLoading) {
    return (
      <section data-testid="intent-loading">
        <SectionLabel icon="Target">{t("title")}</SectionLabel>
        <Skeleton height={120} />
      </section>
    );
  }

  if (isError) {
    return (
      <section>
        <SectionLabel icon="Target">{t("title")}</SectionLabel>
        <ErrorState title={t("error.title")} body={t("error.body")} onRetry={() => refetch()} />
      </section>
    );
  }

  const intent = data?.intent ?? null;
  if (!intent) {
    return (
      <section>
        <SectionLabel icon="Target">{t("title")}</SectionLabel>
        <div style={s.card}>
          <EmptyState
            icon="Target"
            title={t("empty.title")}
            body={t("empty.body")}
            cta={t("empty.cta")}
            onCta={() => derive.mutate({})}
            ctaLoading={derive.isPending}
          />
        </div>
      </section>
    );
  }

  const stale = data?.stale === true;
  return (
    <section>
      <SectionLabel
        icon="Target"
        right={
          <div style={s.right}>
            {stale && (
              <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
                {t("stale")}
              </Badge>
            )}
            <Badge color={CONFIDENCE_COLOR[intent.confidence]}>{t(`confidence.${intent.confidence}`)}</Badge>
            <Badge>{t(`basis.${intent.basis}`)}</Badge>
            {stale && (
              <Button
                kind="secondary"
                size="sm"
                icon="RefreshCw"
                loading={derive.isPending}
                onClick={() => derive.mutate({ force: true })}
              >
                {t("rederive")}
              </Button>
            )}
          </div>
        }
      >
        {t("title")}
      </SectionLabel>
      <div style={s.card}>
        <blockquote style={s.quote}>{intent.intent}</blockquote>
        {intent.confidence === "low" && <div style={s.hint}>{t("lowHint")}</div>}

        {(intent.in_scope.length > 0 || intent.out_of_scope.length > 0) && (
          <div style={s.scopeGrid}>
            <div>
              <div style={s.scopeLabel}>{t("inScope")}</div>
              <ul style={s.list}>
                {intent.in_scope.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
            <div>
              <div style={s.scopeLabel}>{t("outOfScope")}</div>
              <ul style={s.list}>
                {intent.out_of_scope.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {intent.risk_areas.length > 0 && (
          <div>
            <div style={s.scopeLabel}>{t("risks")}</div>
            <div style={s.chips}>
              {intent.risk_areas.map((r, i) => (
                <Chip key={i} icon={RISK_ICON[r.kind]}>
                  {r.label}
                </Chip>
              ))}
            </div>
          </div>
        )}

        <div style={s.footer}>
          <span>{t("derivedFrom")}:</span>
          {intent.sources.map((src, i) => (
            <React.Fragment key={`s${i}`}>
              {i > 0 && <span aria-hidden>·</span>}
              <span className="mono">
                {t(`sourceKind.${src.kind}`)} {src.ref}
                {src.truncated ? ` (${t("truncated")})` : ""}
              </span>
            </React.Fragment>
          ))}
          {intent.unresolved_refs.map((u, i) => (
            <React.Fragment key={`u${i}`}>
              {(i > 0 || intent.sources.length > 0) && <span aria-hidden>·</span>}
              <span className="mono" style={s.unresolved}>
                {u.ref} — {u.reason}
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

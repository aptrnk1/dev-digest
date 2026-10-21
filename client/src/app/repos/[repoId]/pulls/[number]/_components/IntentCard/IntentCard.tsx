/* IntentCard — what the PR is trying to do (derived from spec/ticket/description):
   quote, scope, risk areas, confidence + provenance. Sits above Description.
   With no stored intent it derives one once on open (cheap classifier, cached
   by input hash); a stale intent is only re-derived on request. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Chip, EmptyState, ErrorState, SectionLabel, Skeleton } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
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
  const autoDerivedFor = React.useRef<string | null>(null);
  const missing = !!prId && !!data && !data.intent;

  // Auto-derive once per PR when nothing is stored. A failure falls back to
  // the manual empty state below — no retry loop.
  React.useEffect(() => {
    if (!missing || autoDerivedFor.current === prId) return;
    autoDerivedFor.current = prId;
    derive.mutate({});
  }, [missing, prId, derive]);

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
  if (!intent && !derive.isError) {
    return (
      <section data-testid="intent-deriving">
        <SectionLabel icon="Target">{t("title")}</SectionLabel>
        <div style={s.card}>
          <div style={s.hint}>{t("deriving")}</div>
          <Skeleton height={96} />
        </div>
      </section>
    );
  }

  if (!intent) {
    const notConfigured = derive.error instanceof ApiError && derive.error.code === "llm_not_configured";
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
          <div style={s.hint}>{t(notConfigured ? "deriveError.notConfigured" : "deriveError.generic")}</div>
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

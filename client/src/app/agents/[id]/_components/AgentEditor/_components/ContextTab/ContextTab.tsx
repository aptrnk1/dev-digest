/* ContextTab — Project context attached to this agent for the active repo.
   Thin wrapper over the shared ContextDocsPanel: heading + "{n} of {total}
   attached" badge on top, token budget footer below. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Agent } from "@devdigest/shared";
import { ContextDocsPanel, type PanelSummary } from "@/components/context-docs";
import { useActiveRepo } from "@/lib/repo-context";
import { CONTEXT_TOKEN_BUDGET } from "./constants";
import { s } from "./styles";

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { activeRepo } = useActiveRepo();
  const repo = activeRepo ? { id: activeRepo.id, full_name: activeRepo.full_name } : null;
  const perFileCalls = agent.strategy === "map-reduce" || agent.strategy === "auto";

  return (
    // key: fresh panel state per (agent, repo) pair — never show or save the previous pair's rows.
    <ContextDocsPanel
      key={`${agent.id}:${repo?.id ?? ""}`}
      owner={{ kind: "agent", id: agent.id }}
      repo={repo}
      header={(sum: PanelSummary) => (
        <>
          <h2 style={s.h2}>{t("context.title", { repo: repo?.full_name ?? "" })}</h2>
          <span style={s.badge}>{t("context.badge", { attached: sum.attachedCount, total: sum.totalDocs })}</span>
        </>
      )}
      footer={(sum: PanelSummary) => (
        <div style={s.footer}>
          <div style={s.sum}>
            <span className="mono" style={s.total}>
              {t("context.budget", { n: sum.okTokens })}
            </span>
            {sum.okTokens > CONTEXT_TOKEN_BUDGET && <span style={s.warn}>{t("context.overBudget")}</span>}
          </div>
          {perFileCalls && <span style={s.note}>{t("context.mapReduce")}</span>}
          <span style={s.note}>{t("context.injected")}</span>
        </div>
      )}
    />
  );
}

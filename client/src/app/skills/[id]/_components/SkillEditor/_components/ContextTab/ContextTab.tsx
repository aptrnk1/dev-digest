/* ContextTab (skill) — project docs this skill brings to every agent that uses it.
   Thin wrapper over the shared ContextDocsPanel: header (title + count badge +
   hint) and a "SERIALIZES AS" preview of the prompt section. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ContextDocsPanel, type PanelSummary } from "@/components/context-docs";
import { useActiveRepo } from "@/lib/repo-context";
import { s } from "./styles";

export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("context");
  const { activeRepo } = useActiveRepo();
  const repo = activeRepo ? { id: activeRepo.id, full_name: activeRepo.full_name } : null;

  const header = (sum: PanelSummary) => (
    <div style={s.head}>
      <div style={s.titleRow}>
        <span style={s.title}>{t("panel.skillTitle", { repo: repo?.full_name ?? "" })}</span>
        {repo && <Badge color="var(--accent-text)">{t("panel.attachedCount", { attached: sum.attachedCount })}</Badge>}
      </div>
      <span style={s.hint}>{t("panel.skillHint")}</span>
    </div>
  );

  const footer = (sum: PanelSummary) => (
    <div style={s.serializes}>
      <div style={s.label}>{t("panel.serializesAs")}</div>
      {sum.attachedPaths.length === 0 ? (
        <div style={s.hint}>{t("panel.nothingAttached")}</div>
      ) : (
        <pre style={s.pre}>{[t("panel.serializeHeading"), ...sum.attachedPaths.map((p) => `- ${p}`)].join("\n")}</pre>
      )}
    </div>
  );

  // key: a fresh panel per (skill, repo) pair — never show one pair's rows under another.
  return (
    <ContextDocsPanel
      key={`${skill.id}:${repo?.id ?? ""}`}
      owner={{ kind: "skill", id: skill.id }}
      repo={repo}
      header={header}
      footer={footer}
    />
  );
}

"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SectionLabel } from "@devdigest/ui";
import type { Risk } from "@devdigest/shared";
import { SEVERITY_COLOR } from "./constants";
import { s } from "./styles";

export function BriefRisks({ risks }: { risks: Risk[] }) {
  const t = useTranslations("brief");

  return (
    <section>
      <SectionLabel icon="AlertTriangle">{t("block.risks")}</SectionLabel>
      {risks.length === 0 ? (
        <div style={s.empty}>{t("noRisks")}</div>
      ) : (
        <ul style={s.list}>
          {risks.map((r, i) => (
            <li key={i} style={s.row}>
              <span role="img" aria-label={t(`severity.${r.severity}`)} style={{ color: SEVERITY_COLOR[r.severity], display: "inline-flex" }}>
                <Icon.AlertTriangle size={16} />
              </span>
              <span style={s.title}>{r.title}</span>
              {r.file_refs[0] && <span style={s.file}>{r.file_refs[0]}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

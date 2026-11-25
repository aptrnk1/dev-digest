/* SmartDiffGroup — one role group on Files changed: header (label, file count,
   files-with-findings counter) that collapses its FileCards. Boilerplate starts
   collapsed unless it carries findings. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { FileCard, type DiffCommentApi } from "@/components/diff-viewer";
import { ROLE_LABEL_KEY } from "../../constants";
import type { ResolvedGroup } from "../../helpers";
import { s } from "./styles";

export function SmartDiffGroup({
  group,
  commenting,
  renderFinding,
}: {
  group: ResolvedGroup;
  commenting?: DiffCommentApi;
  renderFinding?: (f: FindingRecord) => React.ReactNode;
}) {
  const t = useTranslations("prReview");
  const [open, setOpen] = React.useState(group.role !== "boilerplate" || group.files_with_findings > 0);

  return (
    <div style={s.group} data-role={group.role}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={s.header}>
        <Icon.ChevronRight size={13} style={s.chevron(open)} />
        <span style={s.label}>{t(`smartDiff.${ROLE_LABEL_KEY[group.role]}`)}</span>
        <span style={s.meta}>{t("smartDiff.filesCount", { count: group.files.length })}</span>
        {group.files_with_findings > 0 && (
          <span style={s.findings}>{t("smartDiff.filesWithFindings", { count: group.files_with_findings })}</span>
        )}
      </button>
      {open && (
        <div style={s.body}>
          {group.files.map((rf) => (
            <FileCard
              key={rf.file.path}
              file={rf.file}
              commenting={commenting}
              findings={rf.findings}
              maxSeverity={rf.maxSeverity}
              renderFinding={renderFinding}
            />
          ))}
        </div>
      )}
    </div>
  );
}

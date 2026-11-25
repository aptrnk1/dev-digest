/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { anchorFindings, SEVERITY_COLOR } from "../findings";
import { s, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

const NO_FINDINGS: FindingRecord[] = [];

export function FileCard({
  file,
  commenting,
  findings = NO_FINDINGS,
  maxSeverity,
  renderFinding,
  target = false,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  /** Review findings for this file (overlay; rendered inline under the code). */
  findings?: FindingRecord[];
  maxSeverity?: FindingRecord["severity"] | null;
  renderFinding?: (f: FindingRecord) => React.ReactNode;
  /** Deep-link target: open, scroll the header into view and focus it (once per mount). */
  target?: boolean;
}) {
  const t = useTranslations("shell");
  const tp = useTranslations("prReview");
  const hasFindings = findings.length > 0;
  const [open, setOpen] = React.useState(
    target || hasFindings || (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const headerRef = React.useRef<HTMLDivElement>(null);
  const jumped = React.useRef(false);
  React.useEffect(() => {
    if (!target || jumped.current) return;
    jumped.current = true;
    setOpen(true);
    const el = headerRef.current;
    el?.scrollIntoView?.({ block: "start" });
    el?.focus({ preventScroll: true });
  }, [target]);
  // Findings can arrive after mount (reviews load later): open then, unless the
  // user already toggled this card themselves.
  const touched = React.useRef(false);
  React.useEffect(() => {
    if (hasFindings && !touched.current) setOpen(true);
  }, [hasFindings]);
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);
  const anchored = React.useMemo(() => anchorFindings(lines, findings), [lines, findings]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    <div style={s.fileCard}>
      <div ref={headerRef} tabIndex={-1} onClick={() => {
          touched.current = true;
          setOpen((o) => !o);
        }} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {hasFindings && (
          <span
            style={{
              ...s.findingBadge,
              color: maxSeverity ? SEVERITY_COLOR[maxSeverity as keyof typeof SEVERITY_COLOR] : "var(--text-muted)",
            }}
          >
            {tp("smartDiff.findingsCount", { count: findings.length })}
          </span>
        )}
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                findings={ln.newNo != null && ln.kind !== "del" ? anchored.byNewLine.get(ln.newNo) : undefined}
                renderFinding={renderFinding}
              />
            ))
          )}
          {renderFinding && anchored.fileLevel.length > 0 && (
            <div style={s.fileFindings}>
              <span style={s.fileFindingsLabel}>{tp("smartDiff.findingsOutsideDiff")}</span>
              {anchored.fileLevel.map((f) => (
                <React.Fragment key={f.id}>{renderFinding(f)}</React.Fragment>
              ))}
            </div>
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}

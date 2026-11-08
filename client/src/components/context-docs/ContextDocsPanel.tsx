/* ContextDocsPanel — shared body of the agent/skill Context tabs: own
   attachments (ordered, drag + ArrowUp/Down), inherited docs, then the rest of
   the repo's documents. Every change is saved immediately (optimistic in the hook). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Checkbox, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { useContextFiles } from "@/lib/hooks/core";
import { useContextAttachments, useSetContextAttachments } from "@/lib/hooks/context";
import { useToast } from "@/lib/toast";
import { ContextPreviewDrawer } from "./ContextPreviewDrawer";
import { baseName, buildRows, filterRows, isNotCloned, moveItem, summarize, type Row } from "./helpers";
import { s } from "./styles";
import type { ContextDocsPanelProps, PanelSummary } from "./types";

const TAG_COLOR = { specs: "var(--accent-text)", docs: "var(--ok)", insights: "var(--sugg)" } as const;
const EMPTY_SUMMARY: PanelSummary = { attachedCount: 0, totalDocs: 0, okTokens: 0, attachedPaths: [] };

export function ContextDocsPanel({ owner, repo, header, footer }: ContextDocsPanelProps) {
  const t = useTranslations("context");
  const toast = useToast();
  const repoId = repo?.id ?? null;
  const files = useContextFiles(repoId);
  const atts = useContextAttachments(owner, repoId);
  const save = useSetContextAttachments(owner, repoId);
  const [filter, setFilter] = React.useState("");
  const [dragFrom, setDragFrom] = React.useState<number | null>(null);
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const closePreview = React.useCallback(() => setPreviewPath(null), []);

  const rows = files.data && atts.data ? buildRows(files.data.docs, atts.data) : null;
  const sum = rows ? summarize(rows) : null;
  const summary: PanelSummary =
    rows && sum
      ? {
          attachedCount: sum.attachedPaths.length,
          totalDocs: files.data!.docs.length,
          okTokens: sum.okTokens,
          attachedPaths: sum.attachedPaths,
        }
      : EMPTY_SUMMARY;

  const commit = (paths: string[], current?: string[]) => {
    if (paths === current) return; // no-op move (edge of the list)
    save.mutate(paths, {
      onError: (err: unknown) => toast.error(t("panel.saveError", { message: (err as Error).message })),
    });
  };

  const renderBody = () => {
    if (!repo) return <div style={s.msg}>{t("panel.noRepo")}</div>;
    if (isNotCloned(files.error) || isNotCloned(atts.error)) return <div style={s.msg}>{t("panel.notCloned")}</div>;
    if (files.isError || atts.isError) {
      return <ErrorState body={t("panel.loadError")} onRetry={() => (files.refetch(), atts.refetch())} />;
    }
    if (!rows || !sum) {
      return (
        <div data-testid="context-skeleton" style={s.skeletons}>
          <Skeleton height={44} />
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      );
    }
    const visible = filterRows(rows, filter);
    const canReorder = filter.trim() === "";
    const own = sum.attachedPaths;
    return (
      <>
        {files.data!.docs.length === 0 && <div style={s.msg}>{t("panel.empty")}</div>}
        {rows.length > 0 && visible.length === 0 && <div style={s.msg}>{t("panel.noMatch", { q: filter })}</div>}
        <ol style={s.list}>
          {visible.map((row) => {
            const isOwn = row.kind === "own";
            const ownIndex = isOwn ? own.indexOf(row.path) : -1;
            return (
              <li
                key={row.path}
                draggable={canReorder && isOwn}
                onDragStart={() => isOwn && setDragFrom(ownIndex)}
                onDragOver={(e) => canReorder && isOwn && e.preventDefault()}
                onDrop={() => {
                  if (dragFrom !== null && isOwn) commit(moveItem(own, dragFrom, ownIndex), own);
                  setDragFrom(null);
                }}
                onDragEnd={() => setDragFrom(null)}
                style={s.row(isOwn, row.kind === "free" && row.status === "too_large", isOwn && dragFrom === ownIndex)}
              >
                <RowBody
                  row={row}
                  canReorder={canReorder}
                  onToggle={() => commit(isOwn ? own.filter((p) => p !== row.path) : [...own, row.path])}
                  onMove={(delta) => commit(moveItem(own, ownIndex, ownIndex + delta), own)}
                  onPreview={(el) => {
                    el.focus();
                    setPreviewPath(row.path);
                  }}
                />
              </li>
            );
          })}
        </ol>
      </>
    );
  };

  return (
    <div style={s.wrap}>
      <div style={s.top}>
        <div style={s.headSlot}>{header(summary)}</div>
        <div style={s.filter}>
          <Icon.Search size={13} style={s.filterIcon} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("panel.filter")}
            aria-label={t("panel.filter")}
            style={s.filterInput}
          />
        </div>
      </div>
      {renderBody()}
      {footer && <div style={s.footer}>{footer(summary)}</div>}
      {repo && previewPath && <ContextPreviewDrawer repoId={repo.id} path={previewPath} onClose={closePreview} />}
    </div>
  );
}

function RowBody({
  row,
  canReorder,
  onToggle,
  onMove,
  onPreview,
}: {
  row: Row;
  canReorder: boolean;
  onToggle: () => void;
  onMove: (delta: number) => void;
  onPreview: (el: HTMLElement) => void;
}) {
  const t = useTranslations("context");
  const own = row.kind === "own";
  const isOk = row.status === "ok";
  const gripOn = own && canReorder;
  const label = (
    <span className="mono" style={s.name}>
      {baseName(row.path)}
    </span>
  );

  return (
    <>
      {row.kind === "inherited" ? (
        <span style={s.gripSpacer} />
      ) : (
        <button
          type="button"
          aria-label={t("panel.grip", { path: row.path })}
          disabled={!gripOn}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              onMove(e.key === "ArrowUp" ? -1 : 1);
            }
          }}
          style={s.grip(gripOn)}
        >
          <Icon.Menu size={15} />
        </button>
      )}
      {row.kind !== "inherited" && isOk ? <Checkbox checked={own} onChange={onToggle} label={label} /> : label}
      <span className="mono" style={s.folder}>
        {row.folder}
      </span>
      {row.kind === "inherited" && <Badge color="var(--accent-text)">{t("panel.via", { skill: row.skillName })}</Badge>}
      <span style={s.spacer} />
      {row.status === "too_large" && <span style={s.muted}>{t("panel.tooLarge")}</span>}
      {row.status === "missing" && <span style={s.muted}>{t("panel.missing")}</span>}
      {isOk && row.tokens !== null && (
        <span className="mono" style={s.muted}>
          {t("panel.tokens", { n: row.tokens })}
        </span>
      )}
      {isOk && row.category && <Badge color={TAG_COLOR[row.category]}>{row.category}</Badge>}
      {own && !isOk && (
        <Button size="sm" onClick={onToggle}>
          {t("panel.detach")}
        </Button>
      )}
      {isOk && (
        <Button size="sm" icon="Eye" onClick={(e: React.MouseEvent<HTMLButtonElement>) => onPreview(e.currentTarget)}>
          {t("panel.preview")}
        </Button>
      )}
    </>
  );
}

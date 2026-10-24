/* ContextView — Project Context page body: grouped document list (Refresh only)
   on the left, preview with "Used by" / "Attach to…" on the right. */
"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { useContextFiles } from "@/lib/hooks/core";
import { DocPreview } from "./DocPreview";
import { baseName, groupByFolder, pickSelected } from "./helpers";
import { s } from "./styles";

export function ContextView({ repoId, noRepo }: { repoId: string; noRepo?: boolean }) {
  const t = useTranslations("context");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get("doc");
  const [picked, setPicked] = React.useState<string | null>(null);
  const q = useContextFiles(noRepo ? null : repoId);

  const docs = q.data?.docs ?? [];
  const selected = pickSelected(docs, picked ?? requested);
  const selectedPath = selected?.path ?? null;

  // Keep ?doc= in sync with the selection (AC14).
  React.useEffect(() => {
    if (selectedPath && selectedPath !== requested) {
      router.replace(`${pathname}?doc=${encodeURIComponent(selectedPath)}`);
    }
  }, [selectedPath, requested, pathname, router]);

  if (noRepo) {
    return (
      <EmptyState
        icon="Folder"
        title={t("page.noRepo")}
        body={<Link href="/onboarding">{t("page.addRepo")}</Link>}
      />
    );
  }
  if (q.isLoading) {
    return (
      <div data-testid="context-skeleton" style={{ ...s.list, width: 320 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} height={26} />
        ))}
      </div>
    );
  }
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.code === "repo_not_cloned") {
      return <EmptyState icon="Folder" title={t("page.notCloned")} />;
    }
    return <ErrorState title={t("page.loadError")} onRetry={() => q.refetch()} />;
  }
  if (docs.length === 0) {
    return <EmptyState icon="Folder" title={t("page.empty.title")} body={t("page.empty.body")} />;
  }

  return (
    <div style={s.root}>
      <nav style={s.list}>
        <div style={s.listHead}>
          <div style={{ flex: 1 }}>
            <div style={s.listTitle}>{t("page.listHeader")}</div>
            <div style={s.count}>{t("page.count", { count: docs.length })}</div>
          </div>
          <Button
            size="sm"
            icon="RefreshCw"
            aria-busy={q.isFetching}
            disabled={q.isFetching}
            onClick={() => q.refetch()}
          >
            {t("page.refresh")}
          </Button>
        </div>
        {groupByFolder(docs).map((g) => (
          <div key={g.folder}>
            <div style={s.folder}>{g.folder}</div>
            {g.docs.map((d) => (
              <button
                key={d.path}
                type="button"
                aria-current={d.path === selectedPath}
                onClick={() => setPicked(d.path)}
                style={{
                  ...s.row,
                  ...(d.path === selectedPath ? s.rowActive : null),
                  ...(d.status === "too_large" ? s.rowMuted : null),
                }}
              >
                <span className="mono">{baseName(d.path)}</span>
                {d.status === "too_large" && <span style={s.rowTag}>{t("panel.tooLarge")}</span>}
              </button>
            ))}
          </div>
        ))}
        {q.data?.truncated && <div style={s.note}>{t("page.truncated")}</div>}
      </nav>
      {selected && <DocPreview key={selected.path} repoId={repoId} doc={selected} />}
    </div>
  );
}

/* ContextPreviewDrawer — read-only Markdown preview of one repo document.
   Esc / Close return focus to the element that opened it (the row's Preview). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Drawer, ErrorState, Markdown, Skeleton } from "@devdigest/ui";
import { useContextFile } from "@/lib/hooks/context";
import { s } from "./styles";

export function ContextPreviewDrawer({
  repoId,
  path,
  onClose,
}: {
  repoId: string;
  path: string;
  onClose: () => void;
}) {
  const t = useTranslations("context");
  const file = useContextFile(repoId, path);

  React.useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => opener?.focus?.();
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <Drawer title={<span className="mono">{path}</span>} onClose={onClose}>
      {file.isError ? (
        <ErrorState body={t("preview.loadError")} onRetry={() => file.refetch()} />
      ) : file.isLoading || !file.data ? (
        <div data-testid="context-skeleton" style={s.skeletons}>
          <Skeleton height={20} />
          <Skeleton height={14} />
          <Skeleton height={14} />
        </div>
      ) : (
        <div style={s.md}>
          <Markdown>{file.data.content}</Markdown>
        </div>
      )}
    </Drawer>
  );
}

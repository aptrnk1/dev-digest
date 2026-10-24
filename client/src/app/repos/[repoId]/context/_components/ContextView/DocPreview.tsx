/* DocPreview — right pane: file name, "Used by", "Attach to…" and the GFM preview. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, Markdown, Skeleton } from "@devdigest/ui";
import type { SpecFile } from "@devdigest/shared";
import { useContextFile, useContextUsage } from "@/lib/hooks/context";
import { AttachMenu } from "./AttachMenu";
import { baseName } from "./helpers";
import { s } from "./styles";

export function DocPreview({ repoId, doc }: { repoId: string; doc: SpecFile }) {
  const t = useTranslations("context");
  const ok = doc.status === "ok";
  const file = useContextFile(repoId, ok ? doc.path : null);
  const { data: usage } = useContextUsage(repoId, doc.path);

  return (
    <div style={s.pane}>
      <div style={s.paneHead}>
        <span className="mono" style={s.paneTitle}>
          {baseName(doc.path)}
        </span>
        {usage && (
          <span style={s.usedBy}>
            {t("page.usedBy", { a: usage.agents.length, s: usage.skills.length })}
          </span>
        )}
        {ok && <AttachMenu key={doc.path} repoId={repoId} path={doc.path} usage={usage} />}
      </div>
      <div style={s.body}>
        {!ok ? (
          <p>{t("page.tooLarge")}</p>
        ) : file.isLoading ? (
          <div data-testid="context-skeleton" style={{ display: "grid", gap: 10 }}>
            <Skeleton height={22} width="40%" />
            <Skeleton />
            <Skeleton width="80%" />
          </div>
        ) : file.isError ? (
          <ErrorState title={t("page.previewError")} onRetry={() => file.refetch()} />
        ) : (
          <Markdown>{file.data?.content}</Markdown>
        )}
      </div>
    </div>
  );
}

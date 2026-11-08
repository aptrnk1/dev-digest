/* Project Context — /repos/:repoId/context. Markdown documents of the active
   repo; attach them to agents and skills. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { useRepoNotFound } from "@/lib/repo-context";
import { ContextView } from "./_components/ContextView";

export default function ContextPage() {
  const t = useTranslations("context");
  const { repoId } = useParams<{ repoId: string }>();
  const repoNotFound = useRepoNotFound(repoId);

  return (
    <AppShell crumb={[{ label: t("title") }]}>
      <ContextView key={repoId} repoId={repoId} noRepo={repoNotFound} />
    </AppShell>
  );
}

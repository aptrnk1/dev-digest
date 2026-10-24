/* Onboarding Tour — /repos/:repoId/tour. Generate (or regenerate) a tour of the
   active repo and read its five sections. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { TourView } from "./_components/TourView";

export default function TourPage() {
  const t = useTranslations("onboarding.page");
  const { repoId } = useParams<{ repoId: string }>();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const crumb = [{ label: activeRepo?.full_name ?? "" }, { label: t("crumb") }];

  return (
    <AppShell crumb={crumb}>
      {repoNotFound ? <RepoNotFound /> : <TourView key={repoId} repoId={repoId} repo={activeRepo} />}
    </AppShell>
  );
}

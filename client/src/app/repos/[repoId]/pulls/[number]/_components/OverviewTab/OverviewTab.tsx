"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { usePrBrief } from "@/lib/hooks";
import { BriefCard } from "../BriefCard";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { BriefRisks } from "../BriefRisks";
import { ReviewFocus } from "../ReviewFocus";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  repoId: string;
  repoFullName: string | null;
  headSha: string | null;
}

export function OverviewTab({ prId, prBody, repoId, repoFullName, headSha }: OverviewTabProps) {
  const brief = usePrBrief(prId).data?.brief ?? null;
  return (
    <>
      <BriefCard prId={prId} />
      <div style={s.intentBlastRow}>
        <IntentCard prId={prId} />
        <BlastRadiusCard prId={prId} repoId={repoId} repoFullName={repoFullName} headSha={headSha} />
      </div>
      {brief && <BriefRisks risks={brief.risks.risks} />}
      {brief && <ReviewFocus items={brief.review_focus} />}
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}

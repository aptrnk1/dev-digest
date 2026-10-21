"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment, usePrReviews, useFindingAction } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/smart-diff";
import { notify } from "@/lib/toast";
import type { FindingRecord, PrFile } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { SmartDiffGroup } from "./_components/SmartDiffGroup";
import { indexFindings, resolveGroups } from "./helpers";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** For the github.com deep-links of inline FindingCards. */
  repoFullName?: string | null;
  headSha?: string | null;
}

export function DiffTab({ prId, filesCount, files, canComment, repoFullName, headSha }: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: smartDiff } = useSmartDiff(prId);
  const { data: reviews } = usePrReviews(prId);
  const findingAction = useFindingAction();
  const groups = React.useMemo(
    () => (smartDiff ? resolveGroups(smartDiff, files, indexFindings(reviews)) : null),
    [smartDiff, files, reviews],
  );
  const renderFinding = (f: FindingRecord) => (
    <FindingCard
      f={f}
      defaultExpanded
      repoFullName={repoFullName}
      headSha={headSha}
      pending={findingAction.isPending}
      onAction={(action) => prId && findingAction.mutate({ findingId: f.id, action, prId })}
    />
  );
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          commentCount > 0 ? (
            <Button
              kind="ghost"
              size="sm"
              icon={showComments ? "EyeOff" : "Eye"}
              onClick={() => setShowComments((v) => !v)}
            >
              {showComments ? "Hide comments" : "Show comments"} ({commentCount})
            </Button>
          ) : undefined
        }
      >
        {t("smartDiff.filesChangedTitle", { count: filesCount })}
      </SectionLabel>
      {groups ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {groups.map((g) => (
            <SmartDiffGroup key={g.role} group={g} commenting={commenting} renderFinding={renderFinding} />
          ))}
        </div>
      ) : (
        // Loading or failed: fall back to the flat list; never an error state.
        <DiffViewer files={files} commenting={commenting} />
      )}
    </section>
  );
}

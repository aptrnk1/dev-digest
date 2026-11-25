/* TourView — header (title, Regenerate, Share link), the "On this page" nav,
   status banners and the five section cards; also every non-ideal state
   (loading, load error, no repo, not cloned, empty, generating, failed). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { Repo } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useGenerateOnboarding, useOnboardingTour } from "@/lib/hooks";
import { SECTION_IDS } from "../../helpers";
import { useClipboard } from "../../useClipboard";
import { TourSections } from "../sections";
import { formatAgo, splitAround } from "./helpers";
import { s } from "./styles";

const TOC_KEYS = ["architecture", "criticalPaths", "runLocally", "readingPath", "firstTasks"] as const;
const HINT_ID = "tour-regenerate-hint";

function hashId(): string {
  return typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, "");
}

function Banner({ children, live }: { children: React.ReactNode; live?: boolean }) {
  return live ? (
    <div role="status" aria-live="polite" style={s.banner}>
      {children}
    </div>
  ) : (
    <div role="alert" style={s.banner}>
      {children}
    </div>
  );
}

/** "On this page" nav; the active link follows the URL hash (first one by default). */
function Toc({ activeId, onPick }: { activeId: string; onPick: (id: string) => void }) {
  const t = useTranslations("onboarding.toc");
  return (
    <nav aria-label={t("onThisPage")} style={s.toc}>
      <div style={s.tocTitle}>{t("onThisPage")}</div>
      {SECTION_IDS.map((id, i) => {
        const active = id === activeId;
        return (
          <a
            key={id}
            href={`#${id}`}
            aria-current={active ? "location" : undefined}
            onClick={(e) => {
              e.preventDefault();
              onPick(id);
            }}
            style={{ ...s.tocLink, ...(active ? s.tocLinkActive : null) }}
          >
            {t(TOC_KEYS[i]!)}
          </a>
        );
      })}
    </nav>
  );
}

function GenerateError({ error }: { error: unknown }) {
  const t = useTranslations("onboarding.errors");
  if (!error) return null;
  const code = error instanceof ApiError ? error.code : undefined;
  if (code === "llm_not_configured") {
    const link = t("noKeyLink");
    const parts = splitAround(t("noKey"), link);
    return (
      <Banner>
        {parts ? parts[0] : t("noKey")}
        <a href="/settings/api-keys" style={s.link}>
          {link}
        </a>
        {parts ? parts[1] : null}
      </Banner>
    );
  }
  if (code === "repo_not_cloned") return <Banner>{t("notCloned")}</Banner>;
  const message = error instanceof Error ? error.message : String(error);
  return <Banner>{t("startFailed", { message })}</Banner>;
}

function LoadingSkeleton() {
  return (
    <div style={s.page} aria-busy="true">
      <Skeleton height={40} />
      <Skeleton height={200} />
      <Skeleton height={160} />
    </div>
  );
}

export type ReposStatus = "loading" | "error" | "ready";

export function TourView({
  repoId,
  repo,
  reposStatus = "ready",
  onRetryRepos,
}: {
  repoId: string;
  repo: Repo | null;
  reposStatus?: ReposStatus;
  onRetryRepos?: () => void;
}) {
  const t = useTranslations("onboarding");
  const router = useRouter();
  const copy = useClipboard();
  const { data, isLoading, isError, refetch } = useOnboardingTour(repoId);
  const generate = useGenerateOnboarding(repoId);
  const [activeId, setActiveId] = React.useState<string>(SECTION_IDS[0]);

  const tour = data?.tour ?? null;
  const job = data?.job ?? null;
  const running = job?.status === "running" || generate.isPending;
  const failedJob = !running && job?.status === "failed" ? job : null;
  const cloned = !!repo?.clone_path;
  const connectionLost = isError && !!data;

  // Deep link: follow the hash once the sections are in the DOM.
  const hasTour = !!tour;
  React.useEffect(() => {
    if (!hasTour) return;
    const sync = () => {
      const id = hashId();
      if (!(SECTION_IDS as readonly string[]).includes(id)) return;
      setActiveId(id);
      document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [hasTour]);

  const pick = (id: string) => {
    setActiveId(id);
    window.history.replaceState(null, "", `#${id}`);
    document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };
  const start = () => generate.mutate();

  if (!repo && reposStatus === "loading") {
    return <LoadingSkeleton />;
  }
  if (!repo && reposStatus === "error") {
    return <ErrorState title={t("states.loadError.title")} onRetry={onRetryRepos} />;
  }
  if (!repo) {
    return <EmptyState icon="GitBranch" title={t("states.noRepo")} cta={t("states.addRepo")} onCta={() => router.push("/onboarding")} />;
  }
  if (isLoading) {
    return <LoadingSkeleton />;
  }
  if (isError && !data) {
    return <ErrorState title={t("states.loadError.title")} onRetry={() => refetch()} />;
  }

  if (!tour) {
    if (running) {
      return (
        <div role="status" aria-live="polite">
          <EmptyState icon="RefreshCw" title={t("states.generating.title")} body={t("states.generating.body")} />
        </div>
      );
    }
    return (
      <div>
        {connectionLost && <Banner live>{t("states.connectionLost")}</Banner>}
        <GenerateError error={generate.error} />
        {!cloned ? (
          <EmptyState icon="GitBranch" title={t("states.empty.title")} body={t("states.notCloned")} />
        ) : failedJob ? (
          <>
            <Banner>{t("states.failed", { error: failedJob.error ?? "" })}</Banner>
            <EmptyState icon="RefreshCw" title={t("states.empty.title")} cta={t("states.tryAgain")} onCta={start} />
          </>
        ) : (
          <EmptyState
            icon="Layers"
            title={t("states.empty.title")}
            body={t("states.empty.body")}
            cta={t("states.empty.cta")}
            onCta={start}
          />
        )}
      </div>
    );
  }

  const ago = formatAgo(tour.generated_at);
  const agoText = t(`page.ago.${ago.key}`, { n: ago.n });
  const subtitle =
    tour.index_status !== "none" && tour.files_indexed > 0
      ? t("page.subtitleIndexed", { count: tour.files_indexed, ago: agoText })
      : t("page.subtitleFiles", { ago: agoText });
  const disabled = running || !cloned;
  const titleParts = splitAround(t("page.title", { name: "\u0001" }), "\u0001");

  return (
    <div style={s.layout}>
      <Toc activeId={activeId} onPick={pick} />
      <div style={s.main}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.title}>
              {titleParts ? titleParts[0] : null}
              <span className="mono" style={s.accent}>
                {repo.name}
              </span>
              {titleParts ? titleParts[1] : null}
            </h1>
            <p style={s.subtitle}>{subtitle}</p>
          </div>
          <div style={s.actions}>
            <Button
              icon="RefreshCw"
              onClick={start}
              disabled={disabled}
              aria-busy={running || undefined}
              aria-describedby={!cloned ? HINT_ID : undefined}
              title={!cloned ? t("page.regenerateDisabledHint") : undefined}
            >
              {t("page.regenerate")}
            </Button>
            <Button icon="Link" onClick={() => void copy(window.location.href, "link")}>
              {t("page.shareLink")}
            </Button>
          </div>
        </div>
        {!cloned && (
          <span id={HINT_ID} style={s.srOnly}>
            {t("page.regenerateDisabledHint")}
          </span>
        )}

        <div aria-live="polite">
          {connectionLost && <Banner live>{t("states.connectionLost")}</Banner>}
        </div>
        {running && <Banner live>{t("states.regenerating")}</Banner>}
        {failedJob && <Banner>{t("states.regenerateFailed", { error: failedJob.error ?? "" })}</Banner>}
        <GenerateError error={generate.error} />
        {tour.index_status !== "full" && <Banner live>{t("states.partialIndex")}</Banner>}

        <TourSections tour={tour} repo={{ owner: repo.owner, name: repo.name }} />
      </div>
    </div>
  );
}

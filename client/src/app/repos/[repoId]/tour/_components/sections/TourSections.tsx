"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { OnboardingTour } from "@devdigest/shared";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { githubBlobUrl, parseSummary, SECTION_IDS, toMermaid, truncateMiddle } from "../../helpers";
import { useClipboard } from "../../useClipboard";
import { SectionCard } from "./SectionCard";

type Repo = { owner: string; name: string };

const mono: React.CSSProperties = { fontFamily: "var(--font-mono, monospace)", fontSize: 13 };
const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 12px",
  background: "var(--bg-subtle, rgba(255,255,255,0.03))",
  border: "1px solid var(--border)",
  borderRadius: 8,
  marginBottom: 8,
};
const btn: React.CSSProperties = {
  border: "1px solid var(--border-strong, var(--border))",
  borderRadius: 6,
  padding: "4px 10px",
  fontSize: 13,
  color: "inherit",
  background: "none",
  textDecoration: "none",
  cursor: "pointer",
};

function Empty() {
  const t = useTranslations("onboarding.sections");
  return <p style={{ margin: 0, color: "var(--text-muted)" }}>{t("notEnough")}</p>;
}

function PathText({ path }: { path: string }) {
  return (
    <span title={path} style={{ ...mono, wordBreak: "break-all" }}>
      {truncateMiddle(path, 60)}
    </span>
  );
}

function OpenLink({ repo, sha, path }: { repo: Repo; sha: string; path: string }) {
  const t = useTranslations("onboarding.sections");
  return (
    <a
      href={githubBlobUrl(repo.owner, repo.name, sha, path)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("openLabel", { path })}
      style={btn}
    >
      {t("open")}
    </a>
  );
}

function Summary({ text }: { text: string }) {
  return (
    <p style={{ margin: "0 0 14px", lineHeight: 1.6 }}>
      {parseSummary(text).map((p, i) =>
        p.type === "bold" ? (
          <strong key={i}>{p.value}</strong>
        ) : p.type === "code" ? (
          <code key={i} style={{ ...mono, background: "var(--accent-bg)", color: "var(--accent-text)", padding: "1px 6px", borderRadius: 4 }}>
            {p.value}
          </code>
        ) : (
          <React.Fragment key={i}>{p.value}</React.Fragment>
        ),
      )}
    </p>
  );
}

function Architecture({ tour }: { tour: OnboardingTour }) {
  const t = useTranslations("onboarding.sections");
  const { summary, diagram } = tour.architecture;
  const unavailable = <p style={{ margin: 0, color: "var(--text-muted)" }}>{t("diagramUnavailable")}</p>;
  return (
    <>
      {summary ? <Summary text={summary} /> : <Empty />}
      {diagram.nodes.length > 0 ? (
        <MermaidDiagram chart={toMermaid(diagram)} fallback={unavailable} />
      ) : (
        unavailable
      )}
    </>
  );
}

function CriticalPaths({ tour, repo }: { tour: OnboardingTour; repo: Repo }) {
  if (tour.critical_paths.length === 0) return <Empty />;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {tour.critical_paths.map((c) => (
        <li key={c.path} style={row}>
          <Icon.File size={14} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <PathText path={c.path} /> <span style={{ color: "var(--text-muted)" }}>— {c.description}</span>
          </span>
          <OpenLink repo={repo} sha={tour.commit_sha} path={c.path} />
        </li>
      ))}
    </ul>
  );
}

function RunSteps({ tour }: { tour: OnboardingTour }) {
  const t = useTranslations("onboarding.sections");
  const copy = useClipboard();
  if (tour.run_steps.length === 0) return <Empty />;
  return (
    <>
      <p style={{ margin: "0 0 10px", color: "var(--text-muted)", fontSize: 13 }}>{t("runNote")}</p>
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {tour.run_steps.map((s, i) => (
          <li key={`${i}-${s.command}`} style={row}>
            <span style={{ color: "var(--text-muted)", width: 16 }}>{i + 1}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <code style={{ ...mono, display: "block", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{s.command}</code>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("from", { path: s.source_path })}</span>
            </span>
            <button
              type="button"
              aria-label={t("copyLabel", { n: i + 1 })}
              onClick={() => void copy(s.command, "command")}
              style={{ ...btn, border: 0, padding: 4 }}
            >
              <Icon.Copy size={14} />
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

function ReadingPath({ tour }: { tour: OnboardingTour }) {
  if (tour.reading_path.length === 0) return <Empty />;
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {tour.reading_path.map((r, i) => (
        <li key={r.path} style={row}>
          <span style={{ color: "var(--text-muted)", width: 16 }}>{i + 1}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <PathText path={r.path} /> <span style={{ color: "var(--text-muted)" }}>— {r.why}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function FirstTasks({ tour, repo }: { tour: OnboardingTour; repo: Repo }) {
  const t = useTranslations("onboarding.sections");
  if (tour.first_tasks.length === 0) return <Empty />;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {tour.first_tasks.map((task) => (
        <li key={task.title} style={{ ...row, flexDirection: "column", alignItems: "stretch" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong style={{ flex: 1 }}>{task.title}</strong>
            <span style={{ ...btn, cursor: "default", fontSize: 12 }}>{t("size", { size: task.size })}</span>
          </div>
          <span style={{ color: "var(--text-muted)" }}>{task.description}</span>
          {task.files.map((f) => (
            <div key={f} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon.File size={14} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <PathText path={f} />
              </span>
              <OpenLink repo={repo} sha={tour.commit_sha} path={f} />
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}

export function TourSections({ tour, repo }: { tour: OnboardingTour; repo: Repo }) {
  const t = useTranslations("onboarding.sections");
  const [arch, paths, run, reading, tasks] = SECTION_IDS;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionCard id={arch} icon="Layers" title={t("architecture")}>
        <Architecture tour={tour} />
      </SectionCard>
      <SectionCard id={paths} icon="Activity" title={t("criticalPaths")}>
        <CriticalPaths tour={tour} repo={repo} />
      </SectionCard>
      <SectionCard id={run} icon="Command" title={t("runLocally")}>
        <RunSteps tour={tour} />
      </SectionCard>
      <SectionCard id={reading} icon="Workflow" title={t("readingPath")}>
        <ReadingPath tour={tour} />
      </SectionCard>
      <SectionCard id={tasks} icon="ListChecks" title={t("firstTasks")}>
        <FirstTasks tour={tour} repo={repo} />
      </SectionCard>
    </div>
  );
}

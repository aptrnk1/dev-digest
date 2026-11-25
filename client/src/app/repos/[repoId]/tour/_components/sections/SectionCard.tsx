"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@devdigest/ui";

/** Collapsible section card. Expanded by default; the title stays when collapsed. */
export function SectionCard({
  id,
  icon,
  title,
  children,
}: {
  id: string;
  icon: IconName;
  title: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("onboarding.sections");
  const [open, setOpen] = React.useState(true);
  const SectionIcon = Icon[icon];
  const bodyId = `${id}-body`;

  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 16,
        scrollMarginTop: 80,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--accent-bg)",
            color: "var(--accent-text)",
          }}
        >
          <SectionIcon size={16} />
        </span>
        <h2 id={`${id}-title`} style={{ flex: 1, margin: 0, fontSize: 16, fontWeight: 600 }}>
          {title}
        </h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${t("toggle")}: ${title}`}
          onClick={() => setOpen((o) => !o)}
          style={{ background: "none", border: 0, color: "var(--text-muted)", cursor: "pointer", padding: 4 }}
        >
          {open ? <Icon.ChevronDown size={16} /> : <Icon.ChevronRight size={16} />}
        </button>
      </div>
      {open && (
        <div id={bodyId} style={{ marginTop: 14 }}>
          {children}
        </div>
      )}
    </section>
  );
}

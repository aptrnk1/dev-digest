/* AttachMenu — "Attach to…" popover: every agent and skill of the workspace with
   a checkbox for those that already attach the document for this repo. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { ContextDocUsage } from "@devdigest/shared";
import { useAgents } from "@/lib/hooks/agents";
import { useSkills } from "@/lib/hooks/skills";
import { useToggleDocAttachment } from "@/lib/hooks/context";
import type { ContextOwner } from "@/lib/hooks/context";
import { useToast } from "@/lib/toast";
import { s } from "./styles";

interface Props {
  repoId: string;
  path: string;
  usage: ContextDocUsage | undefined;
}

const keyOf = (o: ContextOwner) => `${o.kind}:${o.id}`;

export function AttachMenu({ repoId, path, usage }: Props) {
  const t = useTranslations("context");
  const toast = useToast();
  const { data: agents } = useAgents();
  const { data: skills } = useSkills();
  const toggle = useToggleDocAttachment(repoId);
  const [open, setOpen] = React.useState(false);
  // Optimistic overrides on top of the server usage; dropped again on failure.
  const [override, setOverride] = React.useState<Record<string, boolean>>({});

  const server = new Set([
    ...(usage?.agents ?? []).map((a) => `agent:${a.id}`),
    ...(usage?.skills ?? []).map((x) => `skill:${x.id}`),
  ]);
  const checked = (o: ContextOwner) => override[keyOf(o)] ?? server.has(keyOf(o));

  const onToggle = (owner: ContextOwner, attach: boolean) => {
    const k = keyOf(owner);
    setOverride((m) => ({ ...m, [k]: attach }));
    toggle.mutate(
      { owner, path, attach },
      {
        onError: (e: Error) => {
          setOverride((m) => {
            const { [k]: _drop, ...rest } = m;
            return rest;
          });
          toast.error(t("attach.error", { message: e.message }));
        },
      },
    );
  };

  const section = (title: string, kind: ContextOwner["kind"], items: { id: string; name: string }[]) => (
    <div role="group" aria-label={title}>
      <div style={s.menuHead}>{title}</div>
      {items.map((it) => {
        const owner = { kind, id: it.id };
        return (
          <label key={it.id} style={s.menuItem}>
            <input
              type="checkbox"
              checked={checked(owner)}
              onChange={(e) => onToggle(owner, e.target.checked)}
            />
            {it.name}
          </label>
        );
      })}
    </div>
  );

  return (
    <div style={s.menuWrap}>
      <Button size="sm" iconRight="ChevronDown" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {t("attach.button")}
      </Button>
      {open && (
        <div style={s.menu}>
          {section(t("attach.agents"), "agent", agents ?? [])}
          {section(t("attach.skills"), "skill", skills ?? [])}
        </div>
      )}
    </div>
  );
}

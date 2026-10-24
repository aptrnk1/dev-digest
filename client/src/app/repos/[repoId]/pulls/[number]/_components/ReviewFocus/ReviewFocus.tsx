"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, SectionLabel } from "@devdigest/ui";
import type { ReviewFocusItem } from "@devdigest/shared";
import { s } from "./styles";

export function ReviewFocus({ items }: { items: ReviewFocusItem[] }) {
  const t = useTranslations("brief");
  const router = useRouter();
  const pathname = usePathname();

  const hrefFor = (it: ReviewFocusItem) =>
    `${pathname}?tab=diff&file=${encodeURIComponent(it.file)}&line=${it.line}`;

  return (
    <section>
      <SectionLabel icon="Target" right={<Badge>{items.length}</Badge>}>
        {t("focus.title")}
      </SectionLabel>
      {items.length === 0 ? (
        <div style={s.empty}>{t("noFocus")}</div>
      ) : (
        <ol style={s.list}>
          {items.map((it, i) => (
            <li key={i} style={s.row}>
              <a
                href={hrefFor(it)}
                style={s.link}
                onClick={(e) => {
                  e.preventDefault();
                  router.replace(hrefFor(it));
                }}
              >
                {`${it.file}:${it.line} — ${it.reason}`}
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

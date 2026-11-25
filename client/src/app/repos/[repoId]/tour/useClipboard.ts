"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/lib/toast";

/** Writes text to the clipboard and reports the outcome with a toast. */
export function useClipboard(): (text: string, kind: "command" | "link") => Promise<void> {
  const t = useTranslations("onboarding.toasts");
  const toast = useToast();
  return React.useCallback(
    async (text, kind) => {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(kind === "link" ? t("linkCopied") : t("copied"));
      } catch {
        toast.error(t("copyFailed"));
      }
    },
    [t, toast],
  );
}

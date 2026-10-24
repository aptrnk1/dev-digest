import type { ReactNode } from "react";
import type { ContextOwner } from "@/lib/hooks/context";

export interface PanelSummary {
  attachedCount: number;
  totalDocs: number;
  /** Tokens of own + inherited attachments with status "ok". */
  okTokens: number;
  attachedPaths: string[];
}

export interface ContextDocsPanelProps {
  owner: ContextOwner;
  repo: { id: string; full_name: string } | null;
  header: (s: PanelSummary) => ReactNode;
  footer?: (s: PanelSummary) => ReactNode;
}

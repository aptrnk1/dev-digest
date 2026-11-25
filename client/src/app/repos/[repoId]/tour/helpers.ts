import type { OnboardingTour } from "@devdigest/shared";

type Diagram = OnboardingTour["architecture"]["diagram"];
type NodeKind = Diagram["nodes"][number]["kind"];

/** Section anchors, in page order. Mirrors the server contract by hand —
 *  the client never imports runtime values from @devdigest/shared. */
export const SECTION_IDS = ["architecture", "critical-paths", "run-locally", "reading-path", "first-tasks"] as const;

const HOST = "https://github.com";

/** https://github.com/{owner}/{name}/blob/{sha}/{path}, every segment encoded. */
export function githubBlobUrl(owner: string, name: string, sha: string, path: string): string {
  const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/");
  return `${HOST}/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/blob/${encodeURIComponent(sha)}/${enc(path)}`;
}

/** Shortens a long path in the middle (by character count), keeping the tail. */
export function truncateMiddle(path: string, max = 60): string {
  if (path.length <= max) return path;
  const keep = max - 1;
  const tail = Math.ceil(keep / 2);
  const head = keep - tail;
  return `${path.slice(0, head)}…${path.slice(path.length - tail)}`;
}

export type SummaryPart = { type: "text" | "code" | "bold"; value: string };

/** Splits a summary into text / `code` / **bold** parts. Code content is literal
 *  (even `**` inside it); unpaired markers stay as plain text. */
export function parseSummary(text: string): SummaryPart[] {
  const parts: SummaryPart[] = [];
  let buf = "";
  const flush = () => {
    if (buf) parts.push({ type: "text", value: buf });
    buf = "";
  };
  let i = 0;
  while (i < text.length) {
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        parts.push({ type: "code", value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        parts.push({ type: "bold", value: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  flush();
  return parts;
}

const KIND_STYLE: Record<NodeKind, string> = {
  external: "stroke:#8b93a1,color:#e5e7eb",
  entry: "stroke:#3b82f6,color:#e5e7eb",
  module: "stroke:#3b82f6,color:#e5e7eb",
  middleware: "stroke:#f59e0b,color:#e5e7eb",
  datastore: "stroke:#10b981,color:#e5e7eb",
};

/** Same character set as the server (AC66); applied again here as defence. */
const cleanLabel = (s: string) => s.slice(0, 40).replace(/[^A-Za-z0-9 ._/*@:-]/g, "_");
const cleanId = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_");

/** Builds a mermaid `flowchart LR` from the structured diagram. */
export function toMermaid(diagram: Diagram): string {
  const ids = new Set<string>();
  const lines = ["flowchart LR"];
  for (const n of diagram.nodes) {
    const id = cleanId(n.id);
    ids.add(id);
    lines.push(`  ${id}["${cleanLabel(n.label)}"]:::${n.kind}`);
  }
  for (const e of diagram.edges) {
    const from = cleanId(e.from);
    const to = cleanId(e.to);
    if (ids.has(from) && ids.has(to)) lines.push(`  ${from} --> ${to}`);
  }
  for (const [kind, style] of Object.entries(KIND_STYLE)) {
    lines.push(`  classDef ${kind} fill:#14161a,stroke-width:1.5px,${style}`);
  }
  return lines.join("\n");
}

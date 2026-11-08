export type Ago = { key: "justNow" | "minutes" | "hours" | "days"; n: number };

/** Elapsed time since `generatedAt`, bucketed for the "last refreshed" subtitle. */
export function formatAgo(generatedAt: string, now: number = Date.now()): Ago {
  const then = Date.parse(generatedAt);
  const m = Number.isNaN(then) ? 0 : Math.max(0, Math.floor((now - then) / 60_000));
  if (m < 1) return { key: "justNow", n: 0 };
  if (m < 60) return { key: "minutes", n: m };
  const h = Math.floor(m / 60);
  if (h < 24) return { key: "hours", n: h };
  return { key: "days", n: Math.floor(h / 24) };
}

/** Splits `message` around the first `needle` so the needle can become a link. */
export function splitAround(message: string, needle: string): [string, string] | null {
  const i = message.indexOf(needle);
  return i < 0 ? null : [message.slice(0, i), message.slice(i + needle.length)];
}

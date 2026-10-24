import { describe, it, expect } from "vitest";
import { formatAgo, splitAround } from "./helpers";

const NOW = Date.parse("2026-10-24T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("formatAgo", () => {
  it("buckets just now / minutes / hours / days", () => {
    expect(formatAgo(ago(30_000), NOW)).toEqual({ key: "justNow", n: 0 });
    expect(formatAgo(ago(5 * 60_000), NOW)).toEqual({ key: "minutes", n: 5 });
    expect(formatAgo(ago(2 * 3_600_000 + 1000), NOW)).toEqual({ key: "hours", n: 2 });
    expect(formatAgo(ago(3 * 86_400_000), NOW)).toEqual({ key: "days", n: 3 });
  });
  it("treats future / invalid timestamps as just now", () => {
    expect(formatAgo(ago(-60_000), NOW).key).toBe("justNow");
    expect(formatAgo("nope", NOW).key).toBe("justNow");
  });
});

describe("splitAround", () => {
  it("splits around the needle or returns null", () => {
    expect(splitAround("Add one in X now.", "X")).toEqual(["Add one in ", " now."]);
    expect(splitAround("abc", "X")).toBeNull();
  });
});

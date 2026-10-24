#!/usr/bin/env node
// Save design screenshots the user attached in the Claude Code chat into the
// repo, so subagents (which never see chat attachments) can `Read` them.
//
//   node scripts/save-designs.mjs <out-dir> [--all] [--session <id>] [--file <path>]...
//
//   default   images of the most recent user message that has images
//   --all     every image the user attached in this session
//   --file    also copy a design file from disk (repeatable)
//   --session transcript to read (default: $CLAUDE_CODE_SESSION_ID)
//
// Claude Code stores pasted images base64-encoded in the session transcript
// (~/.claude/projects/<project>/<session>.jsonl); this script decodes them.
// Files are named D1.png, D2.png … continuing the numbering already in
// <out-dir>; an image identical (sha256) to one already there is skipped.
// Prints one line per file: `saved <path>` or `skip <path> (duplicate of …)`.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";

const args = process.argv.slice(2);
const outDir = args[0];
if (!outDir || outDir.startsWith("--")) {
  console.error("usage: node scripts/save-designs.mjs <out-dir> [--all] [--session <id>] [--file <path>]...");
  process.exit(2);
}
let all = false;
let session = process.env.CLAUDE_CODE_SESSION_ID;
const files = [];
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--all") all = true;
  else if (args[i] === "--session") session = args[++i];
  else if (args[i] === "--file") files.push(args[++i]);
  else { console.error(`save-designs: unknown argument ${args[i]}`); process.exit(2); }
}

const EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" };
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

// ---- collect images: [{ buf, ext, from }] ----
const images = [];
if (session) {
  const projects = join(homedir(), ".claude", "projects");
  const transcript = existsSync(projects)
    ? readdirSync(projects).map((d) => join(projects, d, `${session}.jsonl`)).find(existsSync)
    : undefined;
  if (!transcript) {
    if (files.length === 0) { console.error(`save-designs: transcript for session ${session} not found under ${projects}`); process.exit(1); }
  } else {
    const messages = [];
    for (const line of readFileSync(transcript, "utf8").split("\n")) {
      if (!line) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (o.type !== "user" || o.isSidechain) continue;
      const content = o.message?.content;
      if (!Array.isArray(content)) continue;
      // only images the user attached — not images inside tool results
      const imgs = content.filter((b) => b.type === "image" && b.source?.type === "base64");
      if (imgs.length) messages.push({ ts: o.timestamp, imgs });
    }
    const chosen = all ? messages : messages.slice(-1);
    for (const m of chosen) {
      for (const b of m.imgs) {
        images.push({ buf: Buffer.from(b.source.data, "base64"), ext: EXT[b.source.media_type] ?? ".png", from: `chat ${m.ts ?? ""}`.trim() });
      }
    }
  }
} else if (files.length === 0) {
  console.error("save-designs: no session id ($CLAUDE_CODE_SESSION_ID) and no --file given");
  process.exit(1);
}
for (const f of files) {
  if (!existsSync(f)) { console.error(`save-designs: no such file ${f}`); process.exit(1); }
  images.push({ buf: readFileSync(f), ext: extname(f).toLowerCase() || ".png", from: f });
}
if (images.length === 0) {
  console.error("save-designs: no attached images found (attach the screenshots to your message, or use --all / --file)");
  process.exit(1);
}

// ---- write ----
mkdirSync(outDir, { recursive: true });
const existing = new Map(); // sha → file
let next = 1;
for (const name of readdirSync(outDir)) {
  const m = /^D(\d+)\./.exec(name);
  if (!m) continue;
  next = Math.max(next, Number(m[1]) + 1);
  existing.set(sha(readFileSync(join(outDir, name))), join(outDir, name));
}
for (const img of images) {
  const h = sha(img.buf);
  if (existing.has(h)) { console.log(`skip  ${existing.get(h)} (duplicate, ${img.from})`); continue; }
  const path = join(outDir, `D${next++}${img.ext}`);
  if (img.from.startsWith("chat")) writeFileSync(path, img.buf);
  else copyFileSync(img.from, path);
  existing.set(h, path);
  console.log(`saved ${path} (${Math.round(img.buf.length / 1024)} KB, ${img.from})`);
}

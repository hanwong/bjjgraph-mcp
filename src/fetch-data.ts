#!/usr/bin/env node
// Downloads BJJGraph's authored JSON (content/**/*.json) and writes one local bundle file.
// The download is treated as untrusted data: entries are only ever JSON.parse'd, nothing is
// extracted to disk or executed.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { defaultBundlePath, type Bundle } from "./data.js";

const REPO = "diogoseca/bjjgraph";
const CATEGORIES = ["Positions", "Transitions", "Submissions", "Systems", "Principles", "Learning"];
// Flashcards are quiz material and roughly a quarter of the data; the tools never show them.
const DROP_KEYS = /^flashcards/;

export interface TarEntry {
  path: string;
  data: Buffer;
}

/** Minimal ustar/pax reader: returns regular files plus the pax global "comment" (GitHub puts the commit SHA there). */
export function readTar(buf: Buffer): { entries: TarEntry[]; comment?: string } {
  const entries: TarEntry[] = [];
  let comment: string | undefined;
  let paxPath: string | undefined;
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start: number, len: number) => {
      const raw = header.subarray(start, start + len);
      const end = raw.indexOf(0);
      return raw.subarray(0, end === -1 ? len : end).toString("utf8");
    };
    const size = parseInt(field(124, 12).trim() || "0", 8);
    const type = field(156, 1) || "0";
    const prefix = field(345, 155);
    const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const body = buf.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === "x" || type === "g") {
      const records = parsePax(body);
      if (type === "g" && records.comment) comment = records.comment;
      if (type === "x" && records.path) paxPath = records.path;
      continue;
    }
    const path = paxPath ?? name;
    paxPath = undefined;
    if (type === "0") entries.push({ path, data: Buffer.from(body) });
  }
  return { entries, comment };
}

function parsePax(body: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < body.length) {
    const space = body.indexOf(0x20, i);
    if (space === -1) break;
    const len = parseInt(body.subarray(i, space).toString("utf8"), 10);
    if (!len) break;
    const record = body.subarray(space + 1, i + len - 1).toString("utf8");
    const eq = record.indexOf("=");
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    i += len;
  }
  return out;
}

function stripKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!DROP_KEYS.test(k)) out[k] = stripKeys(v);
    return out;
  }
  return value;
}

/** Turns a GitHub tarball into a bundle keyed by paths relative to content/, e.g. "Positions/Mount.json". */
export function bundleFromTarball(gz: Buffer, ref: string): Bundle {
  const { entries, comment } = readTar(gunzipSync(gz));
  const files: Record<string, unknown> = {};
  let skipped = 0;
  for (const entry of entries) {
    // Paths look like "bjjgraph-main/content/Positions/Mount.json".
    const match = /^[^/]+\/content\/(.+\.json)$/.exec(entry.path);
    if (!match || match[1].includes("..")) continue;
    const rel = match[1];
    if (!CATEGORIES.includes(rel.split("/")[0])) continue;
    try {
      files[rel] = stripKeys(JSON.parse(entry.data.toString("utf8")));
    } catch {
      skipped++;
    }
  }
  const counts: Record<string, number> = {};
  for (const rel of Object.keys(files)) counts[rel.split("/")[0]] = (counts[rel.split("/")[0]] ?? 0) + 1;
  return {
    meta: {
      source: `https://github.com/${REPO}`,
      ref,
      commit: comment && /^[0-9a-f]{40}$/.test(comment) ? comment : undefined,
      fetched_at: new Date().toISOString(),
      counts,
      skipped_invalid_json: skipped,
    },
    files,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const ref = opt("--ref") ?? process.env.BJJGRAPH_REF ?? "main";
  const out = resolve(opt("--out") ?? defaultBundlePath());
  if (!/^[\w./-]+$/.test(ref)) throw new Error(`Invalid ref: ${ref}`);

  const url = `https://codeload.github.com/${REPO}/tar.gz/${ref}`;
  console.error(`Downloading ${url} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const gz = Buffer.from(await res.arrayBuffer());
  console.error(`Downloaded ${(gz.length / 1e6).toFixed(1)} MB, reading JSON …`);

  const bundle = bundleFromTarball(gz, ref);
  if (Object.keys(bundle.files).length === 0) throw new Error("No content/*.json files found in the download.");
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.tmp`;
  writeFileSync(tmp, JSON.stringify(bundle));
  renameSync(tmp, out);
  const c = bundle.meta.counts;
  console.error(
    `Saved ${out}\n  commit ${bundle.meta.commit ?? "(unknown)"}\n  ` +
      CATEGORIES.map((k) => `${k}: ${c[k] ?? 0}`).join(", ") +
      (bundle.meta.skipped_invalid_json ? `\n  skipped ${bundle.meta.skipped_invalid_json} invalid JSON files` : ""),
  );
  console.error("BJJGraph data © Diogo Seca, PolyForm Noncommercial 1.0.0 — noncommercial use only.");
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`fetch-data failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}

export { main as fetchData };

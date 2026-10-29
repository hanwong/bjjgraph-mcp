import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { loadIndex } from "../src/data.js";

// Compiled tests live in dist/test; the fixture stays in the source tree.
export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixture", "content");

export const fixtureIndex = () => loadIndex(FIXTURE_DIR);

function header(name: string, size: number, type: string): Buffer {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, "utf8");
  h.write("0000644\0", 100);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124);
  h.write(type, 156);
  h.write("ustar\0", 257);
  return h;
}

function pad(b: Buffer): Buffer {
  return Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
}

function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let len = body.length + 1;
  while (String(len).length + body.length !== len) len = String(len).length + body.length;
  return `${len}${body}`;
}

/** Builds a gzipped tarball like GitHub's: a pax global header with the commit, then files. */
export function makeTarball(files: Record<string, string>, commit?: string, longNames = false): Buffer {
  const parts: Buffer[] = [];
  if (commit) {
    const body = Buffer.from(paxRecord("comment", commit));
    parts.push(header("pax_global_header", body.length, "g"), pad(body));
  }
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    if (longNames) {
      const body = Buffer.from(paxRecord("path", name));
      parts.push(header("PaxHeader", body.length, "x"), pad(body));
      parts.push(header("truncated", data.length, "0"), pad(data));
    } else {
      parts.push(header(name, data.length, "0"), pad(data));
    }
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

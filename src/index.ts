#!/usr/bin/env node
// Entry point: `bjjgraph-mcp` runs the stdio MCP server; `bjjgraph-mcp fetch-data` downloads the data.
import { statSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { dataLocation, loadIndex, type BjjIndex } from "./data.js";
import { fetchData } from "./fetch-data.js";
import { createServer } from "./server.js";

let cached: { index: BjjIndex; mtimeMs: number } | undefined;

/** Loads the index on first use and reloads it when the data file changes (e.g. after fetch-data). */
function getIndex(): BjjIndex {
  const location = dataLocation();
  let mtimeMs = -1;
  try {
    mtimeMs = statSync(location).mtimeMs;
  } catch {
    // loadIndex reports the missing data with instructions.
  }
  if (!cached || cached.mtimeMs !== mtimeMs) cached = { index: loadIndex(location), mtimeMs };
  return cached.index;
}

async function main() {
  if (process.argv[2] === "fetch-data") {
    process.argv.splice(2, 1);
    await fetchData();
    return;
  }
  const server = createServer(getIndex);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

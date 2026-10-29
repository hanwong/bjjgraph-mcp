// Sanity checks against the real downloaded BJJGraph data (not part of `npm test`).
// Run with: npm run check-data
import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadIndex } from "../src/data.js";
import { createServer } from "../src/server.js";

const t0 = Date.now();
const index = loadIndex();
const loadMs = Date.now() - t0;
const server = createServer(() => index);
const client = new Client({ name: "check", version: "0" });
const [a, b] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(a), client.connect(b)]);

async function call(name: string, args: Record<string, unknown>) {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  assert.notEqual(r.isError, true, `${name} ${JSON.stringify(args)} failed:\n${r.content[0].text}`);
  return r.content[0].text;
}

test(`index loads (${loadMs} ms) with plausible counts`, () => {
  assert.ok(index.positions.size >= 100, `positions: ${index.positions.size}`);
  const moves = [...index.movesFrom.values()].flat();
  assert.ok(moves.length >= 900, `moves: ${moves.length}`);
  // Nearly every move should start from a known position state.
  const states = new Set(index.states());
  const unknown = moves.filter((m) => !states.has(m.from));
  assert.ok(unknown.length < moves.length * 0.02, `moves from unknown states: ${unknown.length}`);
});

test("half guard bottom → back control top", async () => {
  const text = await call("bjj_find_paths", { from: "Half Guard/Bottom", to: "Back Control/Top" });
  assert.match(text, /Route 1: /);
  assert.match(text, /Back Control\/Top/);
});

test("every tool answers on real data", async () => {
  assert.match(await call("bjj_search", { query: "kimura" }), /Kimura/);
  assert.match(await call("bjj_search", { query: "하프가드" }), /Half Guard/);
  assert.match(await call("bjj_get_technique", { name: "Kimura Sweep" }), /Execution steps/);
  assert.match(await call("bjj_get_technique", { name: "Armbar" }), /submission family/);
  assert.match(await call("bjj_get_position", { name: "Closed Guard", role: "bottom" }), /CLOSED GUARD\/BOTTOM/);
  assert.match(await call("bjj_position_options", { position: "Mount", role: "top" }), /From Mount\/Top/);
  assert.match(await call("bjj_find_paths", { from: "Closed Guard/Bottom", to: "Triangle Choke" }), /Finish:/);
  assert.match(await call("bjj_list", { type: "system", limit: 5 }), /system entries/);
  assert.match(await call("bjj_list", { type: "principle", limit: 5 }), /principle entries/);
  assert.match(await call("bjj_get_concept", { name: "Pressure" }), /\[principle\]/);
  assert.match(await call("bjj_about", {}), /PolyForm/);
});

test("every technique and position renders within the page cap", async () => {
  for (const e of index.entries) {
    const tool = e.kind === "position" ? "bjj_get_position" : e.kind === "transition" || e.kind === "submission" ? "bjj_get_technique" : "bjj_get_concept";
    const r = (await client.callTool({ name: tool, arguments: { name: e.name } })) as { content: { text: string }[] };
    const text = r.content[0].text;
    // Either it rendered (with its name), or names collide and candidates are offered.
    assert.ok(text.includes(e.name), `${tool} ${e.name}: ${text.slice(0, 200)}`);
    assert.ok(text.length <= 6200, `${tool} ${e.name}: ${text.length} chars`);
  }
});

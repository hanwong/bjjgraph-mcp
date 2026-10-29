import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadIndex } from "../src/data.js";
import { createServer } from "../src/server.js";
import { fixtureIndex } from "./helpers.js";

async function connect(getIndex = fixtureIndex) {
  const index = getIndex === fixtureIndex ? fixtureIndex() : undefined;
  const server = createServer(index ? () => index : getIndex);
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const client = await connect();
after(async () => {
  await client.close();
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { text: r.content[0].text, isError: r.isError === true };
}

test("lists the tools", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "bjj_about",
    "bjj_find_paths",
    "bjj_get_concept",
    "bjj_get_position",
    "bjj_get_technique",
    "bjj_list",
    "bjj_position_options",
    "bjj_search",
  ]);
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
});

test("bjj_search", async () => {
  const r = await call("bjj_search", { query: "alpha" });
  assert.match(r.text, /\[position\] Alpha Guard/);
  assert.match(r.text, /\[transition\] Alpha Sweep — Alpha Guard\/Bottom → Beta Mount\/Top/);
  const paged = await call("bjj_search", { query: "alpha", limit: 1 });
  assert.match(paged.text, /more — use offset=1/);
  assert.match((await call("bjj_search", { query: "qqqzzz" })).text, /No matches/);
});

test("bjj_get_technique: transition with all sections", async () => {
  const r = await call("bjj_get_technique", { name: "alpha sweep" });
  assert.equal(r.isError, false);
  for (const expected of [
    "# Alpha Sweep [transition]",
    "Also called: Shield Sweep",
    "From: Alpha Guard/Bottom",
    "- success → Beta Mount/Top (gi 60% / no-gi 55%)",
    "Opponent leans forward",
    "1. Grip — Take the sleeve.",
    "- Base out (effectiveness High, → Alpha Guard/Bottom)",
    "Fix: Grip first",
    "Sleeve grip appears",
    "No-gi Alpha Sweep",
    "https://youtu.be/xyz789",
    "Long prose about the sweep.",
  ]) {
    assert.ok(r.text.includes(expected), `missing: ${expected}\n---\n${r.text}`);
  }
  assert.ok(!r.text.includes("drop me"), "flashcards are not shown");
});

test("bjj_get_technique: sections and perspective filter", async () => {
  const r = await call("bjj_get_technique", { name: "Alpha Sweep", sections: ["steps"], perspective: "attacker" });
  assert.match(r.text, /Execution steps/);
  assert.doesNotMatch(r.text, /DEFENDER|Common counters|Long prose/);
});

test("bjj_get_technique: submission family lists variants", async () => {
  const r = await call("bjj_get_technique", { name: "TL" });
  assert.match(r.text, /\[submission family\]/);
  assert.match(r.text, /Test Lock from Beta Mount — from Beta Mount\/Top/);
});

test("bjj_get_technique: ambiguous and unknown names", async () => {
  const amb = await call("bjj_get_technique", { name: "alpha" });
  assert.equal(amb.isError, true);
  assert.match(amb.text, /Did you mean/);
  assert.equal((await call("bjj_get_technique", { name: "qqqzzz" })).isError, true);
});

test("bjj_get_technique: paging", async () => {
  const p1 = await call("bjj_get_technique", { name: "Alpha Sweep", max_chars: 1000 });
  assert.match(p1.text, /\[page 1\/\d+ — call again with page=2/);
  const p2 = await call("bjj_get_technique", { name: "Alpha Sweep", max_chars: 1000, page: 2 });
  assert.ok(p2.text.length <= 1100);
  assert.notEqual(p1.text, p2.text);
});

test("bjj_get_position", async () => {
  const both = await call("bjj_get_position", { name: "AG" });
  assert.match(both.text, /# ALPHA GUARD\/TOP/);
  assert.match(both.text, /# ALPHA GUARD\/BOTTOM/);
  assert.match(both.text, /Alpha Sweep \(gi 30% \/ no-gi 25%\)/);
  assert.match(both.text, /Alpha Back Take \(gi 10% \/ no-gi n\/a\)/);
  const bottom = await call("bjj_get_position", { name: "Alpha Guard/Bottom", sections: ["menu"] });
  assert.doesNotMatch(bottom.text, /ALPHA GUARD\/TOP|Hunts sweeps/);
});

test("bjj_position_options", async () => {
  const r = await call("bjj_position_options", { position: "Alpha Guard", role: "bottom" });
  assert.match(r.text, /From Alpha Guard\/Bottom — 2 techniques \(gi\)/);
  assert.ok(r.text.indexOf("Alpha Sweep") < r.text.indexOf("Alpha Back Take"));
  assert.match(r.text, /success → Beta Mount\/Top 60%; failure → Alpha Guard\/Bottom 30%; counter → Beta Mount\/Bottom 10%/);
  const subs = await call("bjj_position_options", { position: "Beta Mount/Top", type: "submission" });
  assert.match(subs.text, /Test Lock from Beta Mount \[submission\]/);
  assert.doesNotMatch(subs.text, /Beta to Gamma/);
  assert.match(r.text, /PolyForm Noncommercial/);
});

test("bjj_find_paths: position target", async () => {
  const r = await call("bjj_find_paths", { from: "Alpha Guard/Bottom", to: "Gamma Back/Top" });
  assert.match(r.text, /Route 1: 1 step — Alpha Guard\/Bottom → Gamma Back\/Top/);
  assert.match(r.text, /Route 2: 2 steps — Alpha Guard\/Bottom → Beta Mount\/Top → Gamma Back\/Top \(best-case chance ≈ 42%\)/);
  const nogi = await call("bjj_find_paths", { from: "Alpha Guard", from_role: "bottom", to: "Gamma Back", to_role: "top", ruleset: "nogi" });
  assert.doesNotMatch(nogi.text, /Route 2/);
});

test("bjj_find_paths: submission target and no route", async () => {
  const r = await call("bjj_find_paths", { from: "Alpha Guard/Bottom", to: "Test Lock" });
  assert.match(r.text, /to a position to attempt Test Lock/);
  assert.match(r.text, /Finish: Test Lock from Beta Mount \(success 65%\)/);
  const none = await call("bjj_find_paths", { from: "Gamma Back/Top", to: "Alpha Guard/Bottom" });
  assert.match(none.text, /No route found/);
  const bad = await call("bjj_find_paths", { from: "Nowhere Land", to: "Gamma Back" });
  assert.equal(bad.isError, true);
});

test("bjj_list and bjj_get_concept", async () => {
  assert.match((await call("bjj_list", { type: "system" })).text, /Alpha System \(Guard System, Beginner\) — A made-up guard system/);
  const subs = await call("bjj_list", { type: "submission" });
  assert.match(subs.text, /1 submission entries/);
  assert.match((await call("bjj_list", { type: "principle", filter: "levers" })).text, /Leverage/);
  const p = await call("bjj_get_concept", { name: "leverage" });
  assert.match(p.text, /# Leverage \[principle\]/);
  assert.match(p.text, /Application level: Fundamental/);
  assert.match(p.text, /Muscling/);
  assert.match((await call("bjj_get_concept", { name: "Breathing", type: "learning" })).text, /Exhale on effort/);
  assert.match((await call("bjj_get_concept", { name: "Alpha System" })).text, /Alpha sweeps/);
});

test("bjj_about shows source, counts and licence", async () => {
  const r = await call("bjj_about");
  assert.match(r.text, /Positions: 3/);
  assert.match(r.text, /PolyForm Noncommercial 1\.0\.0/);
  assert.match(r.text, /authored estimates/);
});

test("tools explain how to fetch data when it is missing", async () => {
  const c = await connect(() => loadIndex("/nonexistent/bjjgraph.json"));
  const r = (await c.callTool({ name: "bjj_search", arguments: { query: "x" } })) as { content: { text: string }[]; isError?: boolean };
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /npm run fetch-data/);
  await c.close();
});

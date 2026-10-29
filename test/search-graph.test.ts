import assert from "node:assert/strict";
import { test } from "node:test";
import { findPaths, optionsFrom } from "../src/graph.js";
import { resolve, search, translateQuery } from "../src/search.js";
import { fixtureIndex } from "./helpers.js";

const index = fixtureIndex();

test("search: exact, partial, alias and typo", () => {
  assert.equal(search(index, "Alpha Sweep")[0].entry.name, "Alpha Sweep");
  assert.equal(search(index, "alph swe")[0].entry.name, "Alpha Sweep");
  assert.equal(search(index, "shield sweep")[0].entry.name, "Alpha Sweep");
  assert.equal(search(index, "shield sweep")[0].matched, "Shield Sweep");
  assert.equal(search(index, "alpah sweap")[0].entry.name, "Alpha Sweep");
  assert.equal(search(index, "AG", ["position"])[0].entry.name, "Alpha Guard");
  assert.deepEqual(search(index, "zzzz qqqq"), []);
});

test("search: kind filter", () => {
  const kinds = new Set(search(index, "alpha", ["transition"]).map((h) => h.entry.kind));
  assert.deepEqual([...kinds], ["transition"]);
});

test("translateQuery maps common Korean terms", () => {
  assert.equal(translateQuery("하프가드에서 백까지"), "half guard back control");
  assert.equal(translateQuery("암바"), "armbar");
  assert.equal(translateQuery("kimura"), "kimura");
});

test("resolve: exact wins, ambiguity returns candidates", () => {
  const r = resolve(index, "alpha guard", ["position"]);
  assert.ok("entry" in r && r.entry.name === "Alpha Guard");
  const amb = resolve(index, "alpha", ["transition"]);
  assert.ok("candidates" in amb && amb.candidates.length >= 2);
});

test("optionsFrom sorts by attempt weight", () => {
  const names = optionsFrom(index, "Alpha Guard/Bottom", "gi").map((m) => m.entry.name);
  assert.deepEqual(names, ["Alpha Sweep", "Alpha Back Take"]);
});

test("findPaths: shortest first, success outcomes only", () => {
  const paths = findPaths(index, ["Alpha Guard/Bottom"], ["Gamma Back/Top"], { ruleset: "gi", maxPaths: 3, maxSteps: 5 });
  assert.equal(paths.length, 2);
  assert.deepEqual(paths[0].states, ["Alpha Guard/Bottom", "Gamma Back/Top"]);
  assert.equal(paths[0].hops[0].techniques[0].move.entry.name, "Alpha Back Take");
  assert.deepEqual(paths[1].states, ["Alpha Guard/Bottom", "Beta Mount/Top", "Gamma Back/Top"]);
  assert.ok(Math.abs(paths[1].probability - 0.6 * 0.7) < 1e-9);
});

test("findPaths: ruleset without a value drops the edge", () => {
  const paths = findPaths(index, ["Alpha Guard/Bottom"], ["Gamma Back/Top"], { ruleset: "nogi", maxPaths: 3, maxSteps: 5 });
  assert.equal(paths.length, 1);
  assert.equal(paths[0].hops.length, 2);
});

test("findPaths: counters are not edges, and maxSteps is respected", () => {
  // Beta Mount/Bottom is only reachable via a counter outcome.
  assert.deepEqual(findPaths(index, ["Alpha Guard/Bottom"], ["Beta Mount/Bottom"], { ruleset: "gi", maxPaths: 3, maxSteps: 5 }), []);
  const one = findPaths(index, ["Alpha Guard/Bottom"], ["Gamma Back/Top"], { ruleset: "nogi", maxPaths: 3, maxSteps: 1 });
  assert.deepEqual(one, []);
});

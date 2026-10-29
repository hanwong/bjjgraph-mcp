import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DataMissingError, loadIndex, norm, splitState } from "../src/data.js";
import { bundleFromTarball } from "../src/fetch-data.js";
import { fixtureIndex, makeTarball } from "./helpers.js";

test("loads a content directory", () => {
  const index = fixtureIndex();
  assert.equal(index.positions.size, 3);
  assert.equal(index.meta.counts.Transitions, 3);
  assert.equal(index.meta.counts.Submissions, 2);
  assert.deepEqual(index.states().slice(0, 2), ["Alpha Guard/Top", "Alpha Guard/Bottom"]);
});

test("canonicalises state names and indexes executable moves", () => {
  const index = fixtureIndex();
  assert.equal(index.canonicalState("alpha guard/bottom"), "Alpha Guard/Bottom");
  const moves = index.movesFrom.get("Alpha Guard/Bottom")!;
  // "alpha guard/bottom" in the back-take file resolves to the same state.
  assert.deepEqual(moves.map((m) => m.entry.name).sort(), ["Alpha Back Take", "Alpha Sweep"]);
  const sweep = moves.find((m) => m.entry.name === "Alpha Sweep")!;
  assert.deepEqual(sweep.attempt, { gi: 30, nogi: 25 });
  assert.equal(sweep.outcomes[0].to, "Beta Mount/Top");
  // Family hubs are not executable moves; variants are.
  assert.ok(index.movesFrom.get("Beta Mount/Top")!.some((m) => m.entry.name === "Test Lock from Beta Mount"));
  assert.ok(![...index.movesFrom.values()].flat().some((m) => m.entry.isFamily));
});

test("null probabilities stay undefined (not zero)", () => {
  const index = fixtureIndex();
  const take = index.movesFrom.get("Alpha Guard/Bottom")!.find((m) => m.entry.name === "Alpha Back Take")!;
  assert.equal(take.success.nogi, undefined);
  assert.equal(take.attempt?.nogi, undefined);
});

test("submission variants know their family", () => {
  const index = fixtureIndex();
  assert.deepEqual(
    index.variantsOf("Test Lock").map((e) => e.name),
    ["Test Lock from Beta Mount"],
  );
  assert.equal(index.lookup("TL")[0].name, "Test Lock");
});

test("helpers", () => {
  assert.equal(norm("  Half-Guard  (Top)! "), "half guard top");
  assert.equal(norm("De La Riva"), "de la riva");
  assert.deepEqual(splitState("Mount/top"), { position: "Mount", role: "Top" });
  assert.deepEqual(splitState("game-over"), { position: "game-over" });
});

test("missing data gives an actionable error", () => {
  assert.throws(() => loadIndex("/nonexistent/bjjgraph.json"), (err: unknown) => {
    assert.ok(err instanceof DataMissingError);
    assert.match(err.message, /npm run fetch-data/);
    return true;
  });
});

test("bundleFromTarball keeps only content JSON, strips flashcards, reads the commit", () => {
  const commit = "a".repeat(40);
  const gz = makeTarball(
    {
      "bjjgraph-main/README.md": "# readme",
      "bjjgraph-main/graph.json": "{}",
      "bjjgraph-main/content/Positions/Mount.json": JSON.stringify({ name: "Mount", top: { flashcards: [1] }, flashcards_position: [] }),
      "bjjgraph-main/content/Positions/Mount.md": "# md",
      "bjjgraph-main/content/Transitions/Bad.json": "{ not json",
      "bjjgraph-main/content/Other/Thing.json": JSON.stringify({ name: "x" }),
      "bjjgraph-main/scripts/evil.json": JSON.stringify({ name: "outside content" }),
    },
    commit,
  );
  const bundle = bundleFromTarball(gz, "main");
  assert.deepEqual(Object.keys(bundle.files), ["Positions/Mount.json"]);
  assert.deepEqual(bundle.files["Positions/Mount.json"], { name: "Mount", top: {} });
  assert.equal(bundle.meta.commit, commit);
  assert.equal(bundle.meta.skipped_invalid_json, 1);
  assert.deepEqual(bundle.meta.counts, { Positions: 1 });
});

test("bundleFromTarball handles pax long paths", () => {
  const long = `bjjgraph-main/content/Submissions/${"Very Long Family Name ".repeat(5)}/from Somewhere.json`;
  const bundle = bundleFromTarball(makeTarball({ [long]: JSON.stringify({ name: "Long" }) }, undefined, true), "main");
  assert.equal(Object.keys(bundle.files).length, 1);
  assert.ok(Object.keys(bundle.files)[0].endsWith("/from Somewhere.json"));
});

test("loads a bundle file written by fetch-data", () => {
  const dir = mkdtempSync(join(tmpdir(), "bjjgraph-"));
  const file = join(dir, "bjjgraph.json");
  const gz = makeTarball({
    "x/content/Positions/Mount.json": JSON.stringify({ name: "Mount", top: {}, bottom: {} }),
    "x/content/Transitions/Mount Escape.json": JSON.stringify({
      name: "Mount Escape",
      from_position: "Mount/Bottom",
      outcomes: [{ to: "Mount/Top", result: "success", probability: { gi: 40, nogi: 40 } }],
    }),
  });
  writeFileSync(file, JSON.stringify(bundleFromTarball(gz, "main")));
  const index = loadIndex(file);
  assert.equal(index.positions.size, 1);
  assert.equal(index.movesFrom.get("Mount/Bottom")![0].entry.name, "Mount Escape");
});

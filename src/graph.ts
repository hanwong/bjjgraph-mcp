// Position-graph queries: what can be done from a state, and short success paths between states.
import { pick, type BjjIndex, type Move, type Ruleset } from "./data.js";

export function successOutcomes(move: Move) {
  return move.outcomes.filter((o) => o.result === "success");
}

/** Moves from a state, most commonly attempted first (then by success rate). */
export function optionsFrom(index: BjjIndex, state: string, ruleset: Ruleset): Move[] {
  const moves = index.movesFrom.get(state) ?? [];
  return [...moves].sort(
    (a, b) =>
      (pick(b.attempt, ruleset) ?? -1) - (pick(a.attempt, ruleset) ?? -1) ||
      (pick(b.success, ruleset) ?? -1) - (pick(a.success, ruleset) ?? -1) ||
      a.entry.name.localeCompare(b.entry.name),
  );
}

export interface Hop {
  from: string;
  to: string;
  /** Techniques that reach `to` from `from` on success, best probability first. */
  techniques: { move: Move; p: number }[];
}

export interface Path {
  states: string[];
  hops: Hop[];
  /** Product of the best success probability at each hop (0..1). */
  probability: number;
}

interface Edge {
  to: string;
  p: number;
  techniques: { move: Move; p: number }[];
}

function buildEdges(index: BjjIndex, ruleset: Ruleset): Map<string, Edge[]> {
  const states = new Set(index.states());
  const edges = new Map<string, Map<string, Edge>>();
  for (const [from, moves] of index.movesFrom) {
    const out = edges.get(from) ?? new Map<string, Edge>();
    for (const move of moves) {
      for (const o of successOutcomes(move)) {
        if (o.to === from || !states.has(o.to)) continue;
        const p = (pick(o.p, ruleset) ?? 0) / 100;
        if (p <= 0) continue;
        const edge = out.get(o.to) ?? { to: o.to, p: 0, techniques: [] };
        edge.techniques.push({ move, p });
        edge.p = Math.max(edge.p, p);
        out.set(o.to, edge);
      }
    }
    edges.set(from, out);
  }
  const result = new Map<string, Edge[]>();
  for (const [from, out] of edges) {
    const list = [...out.values()];
    for (const e of list) e.techniques.sort((a, b) => b.p - a.p || a.move.entry.name.localeCompare(b.move.entry.name));
    result.set(from, list);
  }
  return result;
}

class Heap<T> {
  private items: { cost: number; value: T }[] = [];
  get size() {
    return this.items.length;
  }
  push(cost: number, value: T) {
    const a = this.items;
    a.push({ cost, value });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].cost <= a[i].cost) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop(): { cost: number; value: T } | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].cost < a[m].cost) m = l;
        if (r < a.length && a[r].cost < a[m].cost) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Up to `maxPaths` simple paths from any source state to any target state, fewest steps first,
 * ties broken by the product of success probabilities. Only success outcomes count as edges.
 */
export function findPaths(
  index: BjjIndex,
  sources: string[],
  targets: string[],
  opts: { ruleset: Ruleset; maxPaths: number; maxSteps: number },
): Path[] {
  const edges = buildEdges(index, opts.ruleset);
  const targetSet = new Set(targets);
  const found: Path[] = [];
  // Cost: steps dominate; -log(probability) only breaks ties between equally short paths.
  const STEP = 1000;
  const heap = new Heap<{ states: string[]; edges: Edge[]; logp: number }>();
  for (const s of new Set(sources)) heap.push(0, { states: [s], edges: [], logp: 0 });
  const pops = new Map<string, number>();
  let budget = 200_000;

  while (heap.size > 0 && found.length < opts.maxPaths && budget-- > 0) {
    const { value } = heap.pop()!;
    const last = value.states[value.states.length - 1];
    if (targetSet.has(last) && value.edges.length > 0) {
      found.push({
        states: value.states,
        hops: value.edges.map((e, i) => ({ from: value.states[i], to: e.to, techniques: e.techniques })),
        probability: Math.exp(value.logp),
      });
      continue;
    }
    const n = (pops.get(last) ?? 0) + 1;
    pops.set(last, n);
    if (n > opts.maxPaths * 4 || value.edges.length >= opts.maxSteps) continue;
    for (const e of edges.get(last) ?? []) {
      if (value.states.includes(e.to)) continue;
      const logp = value.logp + Math.log(e.p);
      heap.push((value.edges.length + 1) * STEP - logp, {
        states: [...value.states, e.to],
        edges: [...value.edges, e],
        logp,
      });
    }
  }
  return found;
}

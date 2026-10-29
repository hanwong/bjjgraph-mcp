// Loads BJJGraph content (a bundle written by fetch-data, or a content/ directory) and indexes it.
// Everything read here is untrusted JSON: it is parsed and read field by field, never executed.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type Role = "Top" | "Bottom";
export type Ruleset = "gi" | "nogi";
export type Kind = "position" | "transition" | "submission" | "system" | "principle" | "learning";
export type Json = Record<string, unknown>;

export interface BundleMeta {
  source: string;
  ref: string;
  commit?: string;
  fetched_at: string;
  counts: Record<string, number>;
  skipped_invalid_json?: number;
}

export interface Bundle {
  meta: BundleMeta;
  files: Record<string, unknown>;
}

export interface Entry {
  kind: Kind;
  name: string;
  aliases: string[];
  /** Path relative to content/, e.g. "Submissions/Armbar/from Mount.json". */
  path: string;
  summary: string;
  raw: Json;
  /** Submissions only: the family hub this variant belongs to (folder name). */
  family?: string;
  isFamily?: boolean;
}

export interface Probability {
  gi?: number;
  nogi?: number;
}

export interface Outcome {
  /** A state like "Mount/Top", "game-over", or occasionally the name of a submission it leads into. */
  to: string;
  result: string;
  p: Probability;
}

/** An executable technique (transition or submission variant) attempted from one state. */
export interface Move {
  entry: Entry;
  from: string;
  outcomes: Outcome[];
  success: Probability;
  /** How often this is attempted from `from`, per the position's own menu (may be missing). */
  attempt?: Probability;
}

const CATEGORY_KIND: Record<string, Kind> = {
  Positions: "position",
  Transitions: "transition",
  Submissions: "submission",
  Systems: "system",
  Principles: "principle",
  Learning: "learning",
};

export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function prob(v: unknown): Probability {
  const o = obj(v);
  return { gi: num(o.gi), nogi: num(o.nogi) };
}

export function pick(p: Probability | undefined, ruleset: Ruleset): number | undefined {
  return p ? p[ruleset] ?? undefined : undefined;
}

/** Lowercase, strip punctuation and accents; used for every name comparison. */
export function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function splitState(state: string): { position: string; role?: Role } {
  const i = state.lastIndexOf("/");
  if (i === -1) return { position: state };
  const role = state.slice(i + 1).toLowerCase();
  if (role === "top" || role === "bottom") {
    return { position: state.slice(0, i), role: role === "top" ? "Top" : "Bottom" };
  }
  return { position: state };
}

export class BjjIndex {
  readonly entries: Entry[] = [];
  readonly positions = new Map<string, Entry>();
  readonly movesFrom = new Map<string, Move[]>();
  private readonly byName = new Map<string, Entry[]>();

  constructor(
    readonly meta: BundleMeta,
    files: Record<string, unknown>,
  ) {
    for (const [path, value] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
      const parts = path.split("/");
      const kind = CATEGORY_KIND[parts[0]];
      const raw = obj(value);
      const name = str(raw.name);
      if (!kind || !name) continue;
      const entry: Entry = {
        kind,
        name,
        aliases: arr(raw.aliases).map(str).filter(Boolean),
        path,
        summary: str(raw.summary) || str(raw.description),
        raw,
      };
      if (kind === "submission") {
        entry.isFamily = raw.is_family === true;
        entry.family = parts.length > 2 ? parts[1] : name;
      }
      this.entries.push(entry);
      if (kind === "position") this.positions.set(norm(name), entry);
      for (const n of [name, ...entry.aliases]) {
        const key = norm(n);
        const list = this.byName.get(key) ?? [];
        list.push(entry);
        this.byName.set(key, list);
      }
    }

    // Attempt weights from each position's own menu, keyed by state then technique name.
    const menu = new Map<string, Map<string, Probability>>();
    for (const p of this.positions.values()) {
      for (const role of ["Top", "Bottom"] as Role[]) {
        const side = obj(p.raw[role.toLowerCase()]);
        const m = new Map<string, Probability>();
        for (const item of arr(side.transitions)) {
          const t = obj(item);
          if (str(t.transition)) m.set(norm(str(t.transition)), prob(t.attempt_probability));
        }
        menu.set(`${p.name}/${role}`, m);
      }
    }

    for (const entry of this.entries) {
      if (entry.kind !== "transition" && entry.kind !== "submission") continue;
      if (entry.isFamily) continue;
      const from = this.canonicalState(str(entry.raw.from_position));
      const outcomes = arr(entry.raw.outcomes)
        .map(obj)
        .filter((o) => str(o.to))
        .map((o) => ({ to: this.canonicalState(str(o.to)), result: str(o.result), p: prob(o.probability) }));
      if (!from || outcomes.length === 0) continue;
      const move: Move = {
        entry,
        from,
        outcomes,
        success: prob(entry.raw.success_rate),
        attempt: menu.get(from)?.get(norm(entry.name)),
      };
      const list = this.movesFrom.get(from) ?? [];
      list.push(move);
      this.movesFrom.set(from, list);
    }
  }

  /** "half guard/bottom" -> "Half Guard/Bottom" using the position's own spelling. */
  canonicalState(state: string): string {
    const { position, role } = splitState(state.trim());
    if (!role) return state.trim();
    const p = this.positions.get(norm(position));
    return `${p ? p.name : position}/${role}`;
  }

  /** Exact (normalized) name or alias lookup. */
  lookup(name: string, kinds?: Kind[]): Entry[] {
    const found = this.byName.get(norm(name)) ?? [];
    return kinds ? found.filter((e) => kinds.includes(e.kind)) : found;
  }

  ofKind(kind: Kind): Entry[] {
    return this.entries.filter((e) => e.kind === kind);
  }

  /** Submission variants grouped under a family hub. */
  variantsOf(family: string): Entry[] {
    return this.entries.filter((e) => e.kind === "submission" && !e.isFamily && e.family === family);
  }

  states(): string[] {
    return [...this.positions.values()].flatMap((p) => [`${p.name}/Top`, `${p.name}/Bottom`]);
  }
}

export class DataMissingError extends Error {}

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function defaultBundlePath(): string {
  return join(PACKAGE_ROOT, "data", "bjjgraph.json");
}

/** BJJGRAPH_DATA may point at a bundle file or at a BJJGraph content/ directory (or a clone containing one). */
export function dataLocation(): string {
  return resolve(process.env.BJJGRAPH_DATA || defaultBundlePath());
}

function readContentDir(dir: string): Record<string, unknown> {
  const root = existsSync(join(dir, "content")) ? join(dir, "content") : dir;
  const files: Record<string, unknown> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith(".json")) {
        try {
          files[relative(root, full).split(sep).join("/")] = JSON.parse(readFileSync(full, "utf8"));
        } catch {
          // Skip unreadable or invalid files rather than failing the whole load.
        }
      }
    }
  };
  walk(root);
  return files;
}

export function loadIndex(location = dataLocation()): BjjIndex {
  if (!existsSync(location)) {
    throw new DataMissingError(
      `BJJGraph data not found at ${location}. Run \`npm run fetch-data\` in the bjjgraph-mcp folder ` +
        "(or set BJJGRAPH_DATA to a bundle file or a BJJGraph content/ directory).",
    );
  }
  if (statSync(location).isDirectory()) {
    const files = readContentDir(location);
    const counts: Record<string, number> = {};
    for (const rel of Object.keys(files)) counts[rel.split("/")[0]] = (counts[rel.split("/")[0]] ?? 0) + 1;
    return new BjjIndex({ source: location, ref: "local directory", fetched_at: "", counts }, files);
  }
  const bundle = obj(JSON.parse(readFileSync(location, "utf8")));
  const meta = obj(bundle.meta) as unknown as BundleMeta;
  return new BjjIndex(meta, obj(bundle.files));
}

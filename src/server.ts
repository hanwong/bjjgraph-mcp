// MCP server definition: tools over the BJJGraph index.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DataMissingError, prob, splitState, str, type BjjIndex, type Entry, type Kind, type Role, type Ruleset } from "./data.js";
import {
  DEFAULT_MAX_CHARS,
  NOTICE,
  POSITION_SECTIONS,
  TECHNIQUE_SECTIONS,
  moveLine,
  paginate,
  pct,
  renderConcept,
  renderPosition,
  renderTechnique,
} from "./format.js";
import { findPaths, optionsFrom } from "./graph.js";
import { resolve, search, type SearchHit } from "./search.js";

export const VERSION = "0.1.0";

const INSTRUCTIONS = `Tools for looking up BJJGraph, a directed graph of Brazilian Jiu-Jitsu positions (each with a Top and Bottom role), transitions, submissions, systems, principles and learning notes.
- Names are English. Translate the user's terms first (e.g. 하프가드 = Half Guard, 백 = Back Control, 마운트 = Mount). Partial names work.
- States are written "Position/Role". Role Top/Bottom is from the point of view of the person doing the technique; e.g. "Back Control/Top" means you have the back.
- Start with bjj_search when unsure of a name. Use bjj_find_paths for "how do I get from X to Y", bjj_position_options for "what can I do from X".
- ${NOTICE} Present it as a study aid, not ground truth.`;

const kindEnum = z.enum(["any", "position", "technique", "transition", "submission", "system", "principle", "learning"]);
const rulesetSchema = z.enum(["gi", "nogi"]).optional().describe("Ruleset for probabilities (default gi).");
const roleSchema = z.enum(["top", "bottom"]);
const pageSchema = z.number().int().min(1).optional().describe("Page number for long results (default 1).");
const maxCharsSchema = z
  .number()
  .int()
  .min(1000)
  .max(20000)
  .optional()
  .describe(`Max characters per page (default ${DEFAULT_MAX_CHARS}).`);

const KIND_FILTER: Record<z.infer<typeof kindEnum>, Kind[] | undefined> = {
  any: undefined,
  position: ["position"],
  technique: ["transition", "submission"],
  transition: ["transition"],
  submission: ["submission"],
  system: ["system"],
  principle: ["principle"],
  learning: ["learning"],
};

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): ToolResult => ({ content: [{ type: "text", text: t }], isError: true });

function hitLine(index: BjjIndex, h: SearchHit): string {
  const e = h.entry;
  const alias = h.matched !== e.name ? ` (alias: ${h.matched})` : "";
  let detail = "";
  if (e.kind === "transition" || (e.kind === "submission" && !e.isFamily)) {
    const from = index.canonicalState(str(e.raw.from_position));
    const move = (index.movesFrom.get(from) ?? []).find((m) => m.entry === e);
    const success = move?.outcomes.find((o) => o.result === "success");
    detail = ` — ${from}${success ? ` → ${success.to}` : ""}`;
  } else if (e.kind === "submission") {
    detail = ` — family of ${index.variantsOf(e.family ?? e.name).length} variants`;
  } else {
    detail = e.summary ? ` — ${e.summary.slice(0, 110)}${e.summary.length > 110 ? "…" : ""}` : "";
  }
  const kind = e.isFamily ? "submission family" : e.kind;
  return `- [${kind}] ${e.name}${alias}${detail}`;
}

function notFound(what: string, name: string, candidates: SearchHit[], index: BjjIndex): ToolResult {
  if (candidates.length === 0) return fail(`No ${what} matching "${name}". Try bjj_search with a shorter or different name.`);
  return fail(
    `"${name}" is ambiguous or inexact. Did you mean one of these? Call again with the exact name.\n` +
      candidates.map((c) => hitLine(index, c)).join("\n"),
  );
}

function resolvePosition(index: BjjIndex, name: string): { entry: Entry; role?: Role } | ToolResult {
  const { position, role } = splitState(name);
  const r = resolve(index, position, ["position"]);
  if ("entry" in r) return { entry: r.entry, role };
  return notFound("position", name, r.candidates, index);
}

const toRoles = (role: "top" | "bottom" | "both" | undefined, fromName?: Role): Role[] => {
  if (role === "top") return ["Top"];
  if (role === "bottom") return ["Bottom"];
  if (role === "both") return ["Top", "Bottom"];
  return fromName ? [fromName] : ["Top", "Bottom"];
};

export function createServer(getIndex: () => BjjIndex): McpServer {
  const server = new McpServer({ name: "bjjgraph", version: VERSION }, { instructions: INSTRUCTIONS });

  // Wraps a handler so missing data or bad input becomes a readable tool error, not a crash.
  const guarded =
    <A>(fn: (index: BjjIndex, args: A) => ToolResult) =>
    async (args: A): Promise<ToolResult> => {
      try {
        return fn(getIndex(), args);
      } catch (err) {
        if (err instanceof DataMissingError) return fail(err.message);
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool(
    "bjj_search",
    {
      title: "Search BJJGraph",
      description:
        "Fuzzy search positions, transitions (sweeps, passes, escapes, takedowns…), submissions, systems, principles and learning notes by name or alias. Partial English names work; common Korean terms are translated.",
      inputSchema: {
        query: z.string().min(1).describe('Name or part of a name, e.g. "half guard", "kimura", "berimbolo".'),
        type: kindEnum.optional().describe("Restrict to one kind (default any). 'technique' = transitions + submissions."),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)."),
        offset: z.number().int().min(0).optional().describe("Skip this many results (paging)."),
      },
      annotations: readOnly,
    },
    guarded((index, { query, type, limit = 10, offset = 0 }) => {
      const hits = search(index, query, KIND_FILTER[type ?? "any"]);
      if (hits.length === 0) return text(`No matches for "${query}".`);
      const pageHits = hits.slice(offset, offset + limit);
      const more = hits.length > offset + limit ? `\n[${hits.length - offset - limit} more — use offset=${offset + limit}]` : "";
      return text(`${hits.length} matches for "${query}":\n${pageHits.map((h) => hitLine(index, h)).join("\n")}${more}`);
    }),
  );

  server.registerTool(
    "bjj_get_technique",
    {
      title: "Get technique detail",
      description:
        "Full detail for one transition or submission: outcomes and probabilities, conditions, key principles, setup, execution steps, common counters, common errors, training progressions, defender recognition cues / defensive options / escapes, variants, related content, safety and video clips. Use `sections` to fetch only what you need.",
      inputSchema: {
        name: z.string().min(1).describe('Technique name, e.g. "Kimura Sweep" or "Armbar from Mount".'),
        perspective: z.enum(["attacker", "defender", "both"]).optional().describe("Whose side to show (default both)."),
        sections: z
          .array(z.enum(TECHNIQUE_SECTIONS))
          .optional()
          .describe("Only include these sections (default all). 'defense' = recognition cues, defensive options, escapes."),
        page: pageSchema,
        max_chars: maxCharsSchema,
      },
      annotations: readOnly,
    },
    guarded((index, { name, perspective = "both", sections, page = 1, max_chars = DEFAULT_MAX_CHARS }) => {
      const r = resolve(index, name, ["transition", "submission"]);
      if (!("entry" in r)) return notFound("technique", name, r.candidates, index);
      return text(paginate(renderTechnique(index, r.entry, { perspective, sections }), page, max_chars));
    }),
  );

  server.registerTool(
    "bjj_get_position",
    {
      title: "Get position detail",
      description:
        "Detail for one position, for the top and/or bottom role: overview, state properties and metrics, key principles, decision tree, common errors, drills, the technique menu with attempt weights, related positions and clips.",
      inputSchema: {
        name: z.string().min(1).describe('Position name, e.g. "Half Guard", "Back Control" (a "/Top" or "/Bottom" suffix also works).'),
        role: z.enum(["top", "bottom", "both"]).optional().describe("Which role(s) to show (default both)."),
        sections: z.array(z.enum(POSITION_SECTIONS)).optional().describe("Only include these sections (default all)."),
        page: pageSchema,
        max_chars: maxCharsSchema,
      },
      annotations: readOnly,
    },
    guarded((index, { name, role, sections, page = 1, max_chars = DEFAULT_MAX_CHARS }) => {
      const p = resolvePosition(index, name);
      if (!("entry" in p)) return p;
      return text(paginate(renderPosition(p.entry, { roles: toRoles(role, p.role), sections }), page, max_chars));
    }),
  );

  server.registerTool(
    "bjj_position_options",
    {
      title: "What can I do from here?",
      description:
        "Lists the transitions and submissions that can be attempted from a position in a given role, most commonly attempted first, with success rate and where each outcome (success / failure / counter) leads.",
      inputSchema: {
        position: z.string().min(1).describe('Position name, e.g. "Half Guard" or "Half Guard/Bottom".'),
        role: roleSchema.optional().describe("top or bottom (default: both, or the role in the name)."),
        type: z.enum(["all", "transition", "submission"]).optional().describe("Filter by kind (default all)."),
        ruleset: rulesetSchema,
        limit: z.number().int().min(1).max(100).optional().describe("Max techniques per role (default 25)."),
        offset: z.number().int().min(0).optional().describe("Skip this many (paging)."),
      },
      annotations: readOnly,
    },
    guarded((index, { position, role, type = "all", ruleset = "gi", limit = 25, offset = 0 }) => {
      const p = resolvePosition(index, position);
      if (!("entry" in p)) return p;
      const blocks: string[] = [];
      for (const r of toRoles(role, p.role)) {
        const state = `${p.entry.name}/${r}`;
        const moves = optionsFrom(index, state, ruleset as Ruleset).filter((m) => type === "all" || m.entry.kind === type);
        const shown = moves.slice(offset, offset + limit);
        const more = moves.length > offset + limit ? `\n[${moves.length - offset - limit} more — use offset=${offset + limit}]` : "";
        blocks.push(
          `# From ${state} — ${moves.length} techniques (${ruleset})\n` +
            (shown.length ? shown.map((m) => moveLine(m, ruleset as Ruleset)).join("\n") : "(none)") +
            more,
        );
      }
      return text(`${blocks.join("\n\n")}\n\n${NOTICE}`);
    }),
  );

  server.registerTool(
    "bjj_find_paths",
    {
      title: "Find paths between positions",
      description:
        'Finds a few shortest routes from one position to another using only successful technique outcomes (e.g. Half Guard bottom → Back Control top). Each step lists the techniques that achieve it. The target may also be a submission (e.g. "Armbar"): routes then end at a position where it can be attempted.',
      inputSchema: {
        from: z.string().min(1).describe('Start position, e.g. "Half Guard" or "Half Guard/Bottom".'),
        to: z.string().min(1).describe('Goal position (e.g. "Back Control/Top") or a submission name.'),
        from_role: roleSchema.optional().describe("Your role at the start (default: as in name, else both)."),
        to_role: roleSchema.optional().describe("Your role at the goal (default: as in name, else both; top = you control)."),
        ruleset: rulesetSchema,
        max_paths: z.number().int().min(1).max(10).optional().describe("How many routes (default 3)."),
        max_steps: z.number().int().min(1).max(8).optional().describe("Max steps per route (default 5)."),
        techniques_per_step: z.number().int().min(1).max(10).optional().describe("Techniques listed per step (default 3)."),
      },
      annotations: readOnly,
    },
    guarded((index, args) => {
      const { from_role, to_role, ruleset = "gi", max_paths = 3, max_steps = 5, techniques_per_step = 3 } = args;
      const src = resolvePosition(index, args.from);
      if (!("entry" in src)) return src;
      const sources = toRoles(from_role, src.role).map((r) => `${src.entry.name}/${r}`);

      let targets: string[];
      let goal: string;
      let finish: Entry[] = [];
      const { position: toName, role: toNameRole } = splitState(args.to);
      const asPos = resolve(index, toName, ["position"]);
      const exactSub = index.lookup(args.to, ["submission"]);
      if ("entry" in asPos && exactSub.length === 0) {
        targets = toRoles(to_role, toNameRole).map((r) => `${asPos.entry.name}/${r}`);
        goal = targets.join(" or ");
      } else {
        const sub = exactSub[0] ? { entry: exactSub[0] } : resolve(index, args.to, ["submission"]);
        if (!("entry" in sub)) {
          const cands = "candidates" in asPos ? asPos.candidates : [];
          return notFound("position or submission", args.to, [...cands, ...sub.candidates].slice(0, 8), index);
        }
        finish = sub.entry.isFamily ? index.variantsOf(sub.entry.family ?? sub.entry.name) : [sub.entry];
        targets = [...new Set(finish.map((v) => index.canonicalState(str(v.raw.from_position))).filter(Boolean))];
        goal = `a position to attempt ${sub.entry.name}`;
        if (targets.length === 0) return fail(`${sub.entry.name} has no executable variants with a starting position.`);
      }

      const paths = findPaths(index, sources, targets, { ruleset: ruleset as Ruleset, maxPaths: max_paths, maxSteps: max_steps });
      const header = `Routes from ${sources.join(" or ")} to ${goal} (${ruleset}, success outcomes only):`;
      if (paths.length === 0) {
        return text(`${header}\nNo route found within ${max_steps} steps. Try a larger max_steps or check the roles.\n\n${NOTICE}`);
      }
      const body = paths.map((p, i) => {
        const lines = [`\n## Route ${i + 1}: ${p.hops.length} step${p.hops.length > 1 ? "s" : ""} — ${p.states.join(" → ")} (best-case chance ≈ ${(p.probability * 100).toFixed(0)}%)`];
        p.hops.forEach((h, j) => {
          const techs = h.techniques
            .slice(0, techniques_per_step)
            .map((t) => `${t.move.entry.name} (${Math.round(t.p * 100)}%)`)
            .join(", ");
          const extra = h.techniques.length > techniques_per_step ? ` +${h.techniques.length - techniques_per_step} more` : "";
          lines.push(`${j + 1}. ${h.from} → ${h.to}: ${techs}${extra}`);
        });
        const end = p.states[p.states.length - 1];
        const subs = finish.filter((v) => index.canonicalState(str(v.raw.from_position)) === end);
        if (subs.length) {
          lines.push(`Finish: ${subs.map((v) => `${v.name} (success ${pct(prob(v.raw.success_rate), ruleset as Ruleset)})`).join(", ")}`);
        }
        return lines.join("\n");
      });
      return text(`${header}${body.join("\n")}\n\nUse bjj_get_technique for steps of any technique.\n${NOTICE}`);
    }),
  );

  server.registerTool(
    "bjj_list",
    {
      title: "List BJJGraph entries",
      description:
        "Lists entries of one kind with a one-line summary: systems (game plans / courses), principles, learning notes, positions or submission families. Optional text filter.",
      inputSchema: {
        type: z.enum(["system", "principle", "learning", "position", "submission"]).describe("What to list. 'submission' lists family hubs."),
        filter: z.string().optional().describe("Only entries whose name or summary contains this text."),
        limit: z.number().int().min(1).max(200).optional().describe("Max entries (default 50)."),
        offset: z.number().int().min(0).optional().describe("Skip this many (paging)."),
      },
      annotations: readOnly,
    },
    guarded((index, { type, filter, limit = 50, offset = 0 }) => {
      let items = index.ofKind(type);
      if (type === "submission") items = items.filter((e) => e.isFamily);
      if (filter) {
        const f = filter.toLowerCase();
        items = items.filter((e) => e.name.toLowerCase().includes(f) || e.summary.toLowerCase().includes(f));
      }
      items.sort((a, b) => a.name.localeCompare(b.name));
      const shown = items.slice(offset, offset + limit);
      const extra = (e: Entry) =>
        e.kind === "system" ? ` (${[str(e.raw.system_type), str(e.raw.difficulty_level)].filter(Boolean).join(", ")})` : "";
      const lines = shown.map((e) => `- ${e.name}${extra(e)} — ${e.summary.slice(0, 100)}${e.summary.length > 100 ? "…" : ""}`);
      const more = items.length > offset + limit ? `\n[${items.length - offset - limit} more — use offset=${offset + limit}]` : "";
      return text(`${items.length} ${type} entries${filter ? ` matching "${filter}"` : ""}:\n${lines.join("\n")}${more}`);
    }),
  );

  server.registerTool(
    "bjj_get_concept",
    {
      title: "Get system, principle or learning note",
      description:
        "Full content of a system (game plan, with study guide and sources), a principle (component skills, decision framework, errors, training approaches) or a learning note.",
      inputSchema: {
        name: z.string().min(1).describe('Name, e.g. "Pressure", "10th Planet Half Guard Bottom System".'),
        type: z.enum(["system", "principle", "learning"]).optional().describe("Restrict to one kind."),
        page: pageSchema,
        max_chars: maxCharsSchema,
      },
      annotations: readOnly,
    },
    guarded((index, { name, type, page = 1, max_chars = DEFAULT_MAX_CHARS }) => {
      const r = resolve(index, name, type ? [type] : ["system", "principle", "learning"]);
      if (!("entry" in r)) return notFound("system, principle or learning note", name, r.candidates, index);
      return text(paginate(renderConcept(r.entry), page, max_chars));
    }),
  );

  server.registerTool(
    "bjj_about",
    {
      title: "About the data",
      description: "Which BJJGraph version is loaded (commit, fetch date, counts), how to refresh it, and the data licence.",
      inputSchema: {},
      annotations: readOnly,
    },
    guarded((index) => {
      const m = index.meta;
      const counts = Object.entries(m.counts ?? {})
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      const moves = [...index.movesFrom.values()].reduce((n, l) => n + l.length, 0);
      return text(
        [
          `bjjgraph-mcp ${VERSION}`,
          `Data: ${m.source} (ref ${m.ref}${m.commit ? `, commit ${m.commit.slice(0, 12)}` : ""})`,
          `Fetched: ${m.fetched_at || "(local directory)"}`,
          `Files: ${counts}`,
          `Indexed: ${index.positions.size} positions (${index.positions.size * 2} states), ${moves} executable techniques`,
          "Refresh: run `npm run fetch-data` in the bjjgraph-mcp folder (BJJGraph updates often), then restart the client.",
          "",
          "Licence: the BJJGraph data is © Diogo Seca, licensed under PolyForm Noncommercial 1.0.0 — noncommercial use only. It is not bundled with this server; each user downloads it.",
          "Caveat: much of BJJGraph's content is produced with AI assistance and its probabilities are authored estimates that have not been validated by a black-belt panel. Treat it as a study aid, not ground truth.",
        ].join("\n"),
      );
    }),
  );

  return server;
}

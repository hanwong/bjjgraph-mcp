// Compact plain-text rendering of BJJGraph records, plus paging so replies stay small.
import { arr, num, obj, pick, str, type BjjIndex, type Entry, type Json, type Move, type Probability, type Ruleset } from "./data.js";

export const DEFAULT_MAX_CHARS = 6000;
export const NOTICE =
  "Source: BJJGraph (© Diogo Seca, PolyForm Noncommercial 1.0.0). Largely AI-assisted content; probabilities are authored estimates, not measured stats.";

export function pct(p: Probability | undefined, ruleset?: Ruleset): string {
  if (!p) return "?";
  // BJJGraph uses null for "not available in this ruleset", which is not the same as 0%.
  const show = (v: number | undefined) => (v === undefined ? "n/a" : `${v}%`);
  if (ruleset) return show(pick(p, ruleset));
  if (p.gi !== undefined && p.gi === p.nogi) return `${p.gi}%`;
  return `gi ${show(p.gi)} / no-gi ${show(p.nogi)}`;
}

const title = (key: string) => key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function clipLine(c: Json): string {
  const secs = num(c.duration);
  const meta = [str(c.channel) || str(c.by), secs ? `${secs}s` : "", str(c.half)].filter(Boolean).join(", ");
  return `https://youtu.be/${str(c.id)} — ${str(c.title)}${meta ? ` (${meta})` : ""}`;
}

/** Renders any JSON value as indented bullet lines. */
export function renderValue(v: unknown, indent = ""): string[] {
  if (v === null || v === undefined || v === "") return [];
  if (typeof v !== "object") return [`${indent}${String(v)}`];
  if (Array.isArray(v)) return v.flatMap((item) => bullet(item, indent));
  const o = v as Json;
  const lines: string[] = [];
  const flat: string[] = [];
  for (const [k, val] of Object.entries(o)) {
    if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) continue;
    if (typeof val !== "object") flat.push(`${title(k)}: ${val}`);
    else {
      if (flat.length) lines.push(`${indent}${flat.splice(0).join(" | ")}`);
      lines.push(`${indent}${title(k)}:`, ...renderValue(val, indent + "  "));
    }
  }
  if (flat.length) lines.push(`${indent}${flat.join(" | ")}`);
  return lines;
}

function bullet(item: unknown, indent: string): string[] {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const o = item as Json;
    if (str(o.id) && str(o.title) && ("duration" in o || "channel" in o)) return [`${indent}- ${clipLine(o)}`];
    const lines = renderValue(o, indent + "  ");
    if (lines.length === 0) return [];
    return [`${indent}- ${lines[0].trimStart()}`, ...lines.slice(1)];
  }
  return renderValue(item, indent).map((l, i) => (i === 0 ? `${indent}- ${l.trimStart()}` : l));
}

function block(heading: string, value: unknown): string[] {
  const body = renderValue(value);
  return body.length ? ["", `## ${heading}`, ...body] : [];
}

function stepLines(steps: unknown[]): string[] {
  return steps.map(obj).map((s, i) => {
    const n = num(s.step_number) ?? i + 1;
    return `${n}. ${str(s.action)}${str(s.description) ? ` — ${str(s.description)}` : ""}`;
  });
}

function counterLines(items: unknown[]): string[] {
  return items.map(obj).map((c) => {
    const extra = [str(c.effectiveness) && `effectiveness ${str(c.effectiveness)}`, str(c.targets_outcome) && `→ ${str(c.targets_outcome)}`]
      .filter(Boolean)
      .join(", ");
    return `- ${str(c.counter)}${extra ? ` (${extra})` : ""}${str(c.your_response) ? `\n  Response: ${str(c.your_response)}` : ""}`;
  });
}

function errorLines(items: unknown[]): string[] {
  return items.map(obj).map((e) => {
    const parts = [str(e.error) || str(e.mistake)];
    if (str(e.consequence)) parts.push(`  Consequence: ${str(e.consequence)}`);
    if (str(e.correction)) parts.push(`  Fix: ${str(e.correction)}`);
    return `- ${parts.join("\n")}`;
  });
}

function withHeading(heading: string, lines: string[]): string[] {
  return lines.length ? ["", `## ${heading}`, ...lines] : [];
}

export function outcomeLines(outcomes: { to: string; result: string; p: Probability }[], ruleset?: Ruleset): string[] {
  return outcomes.map((o) => `- ${o.result || "outcome"} → ${o.to} (${pct(o.p, ruleset)})`);
}

export const TECHNIQUE_SECTIONS = [
  "overview",
  "outcomes",
  "conditions",
  "principles",
  "setup",
  "steps",
  "counters",
  "errors",
  "training",
  "defense",
  "variants",
  "related",
  "safety",
  "clips",
] as const;
export type TechniqueSection = (typeof TECHNIQUE_SECTIONS)[number];
export type Perspective = "attacker" | "defender" | "both";

export function renderTechnique(
  index: BjjIndex,
  e: Entry,
  opts: { perspective: Perspective; sections?: TechniqueSection[] },
): string {
  const r = e.raw;
  const want = (s: TechniqueSection) => !opts.sections || opts.sections.length === 0 || opts.sections.includes(s);
  const lines: string[] = [];
  const label = e.kind === "submission" ? (e.isFamily ? "submission family" : "submission") : "transition";
  lines.push(`# ${e.name} [${label}]`);
  if (e.aliases.length) lines.push(`Also called: ${e.aliases.join(", ")}`);
  if (str(r.from_position)) lines.push(`From: ${index.canonicalState(str(r.from_position))}`);
  if (e.kind === "submission") {
    const facts = [str(r.submission_category), str(r.submission_type), str(r.target_area) && `target: ${str(r.target_area)}`]
      .filter(Boolean)
      .join(" · ");
    if (facts) lines.push(facts);
    if (e.family && e.family !== e.name) lines.push(`Family: ${e.family}`);
  }
  if (r.success_rate) lines.push(`Success rate: ${pct(obj(r.success_rate) as Probability)}`);
  if (str(r.summary)) lines.push("", str(r.summary));

  if (want("outcomes")) {
    const move = (index.movesFrom.get(index.canonicalState(str(r.from_position))) ?? []).find((m) => m.entry === e);
    if (move) lines.push(...withHeading("Outcomes", outcomeLines(move.outcomes)));
  }
  if (want("conditions")) lines.push(...block("Conditions", r.conditions));

  if (e.isFamily) {
    const variants = index.variantsOf(e.family ?? e.name);
    if (variants.length) {
      lines.push(
        "",
        "## Variants (call bjj_get_technique with one of these names)",
        ...variants.map((v) => `- ${v.name}${str(v.raw.from_position) ? ` — from ${str(v.raw.from_position)}` : ""}`),
      );
    }
    if (want("related")) lines.push(...block("Related submissions", r.related_submissions));
  }

  const att = obj(r.attacker);
  const def = obj(r.defender);
  if (opts.perspective !== "defender" && Object.keys(att).length) {
    const a: string[] = [];
    if (want("principles")) a.push(...block("Key principles", att.key_principles));
    if (want("setup")) a.push(...block("Setup requirements", att.setup_requirements));
    if (want("steps")) a.push(...withHeading("Execution steps", stepLines(arr(att.execution_steps))));
    if (want("counters")) a.push(...withHeading("Common counters (and your response)", counterLines(arr(att.common_counters))));
    if (want("errors")) a.push(...withHeading("Common errors", errorLines(arr(att.common_errors))));
    if (want("training")) a.push(...block("Training progressions", att.training_progressions));
    if (want("safety") && str(att.safety_considerations)) a.push(...block("Safety", att.safety_considerations));
    if (want("clips")) a.push(...block("Clips (attacker)", att.clips));
    if (a.length) lines.push("", "# ATTACKER", ...a);
  }
  if (opts.perspective !== "attacker" && Object.keys(def).length) {
    const d: string[] = [];
    if (want("principles")) d.push(...block("Key principles", def.key_principles));
    if (want("defense")) {
      d.push(...block("Recognition cues", def.recognition_cues));
      d.push(...block("Defensive options", def.defensive_options));
      d.push(...block("Escape paths", def.escape_paths));
      d.push(...block("Favorable outcomes", def.favorable_outcomes));
    }
    if (want("errors")) d.push(...withHeading("Common errors", errorLines(arr(def.common_errors))));
    if (want("training")) d.push(...block("Training progressions", def.training_progressions));
    if (want("clips")) d.push(...block("Clips (defender)", def.clips));
    if (d.length) lines.push("", "# DEFENDER", ...d);
  }

  if (want("variants")) {
    lines.push(...block("Variants and adaptations", r.variants_and_adaptations));
    lines.push(...block("Variations and setups", r.variations_and_setups));
  }
  if (want("safety") && Object.keys(obj(r.safety_considerations)).length) lines.push(...block("Safety", r.safety_considerations));
  if (want("related")) lines.push(...block("Related", r.related_content));
  if (want("clips")) lines.push(...block("Clips", r.clips));
  if (want("overview")) {
    lines.push(...block("Overview", r.overview));
    lines.push(...block("Position integration", r.position_integration));
  }
  return lines.join("\n");
}

export const POSITION_SECTIONS = ["overview", "principles", "properties", "decisions", "errors", "drills", "menu", "related", "clips"] as const;
export type PositionSection = (typeof POSITION_SECTIONS)[number];

export function renderPosition(
  e: Entry,
  opts: { roles: ("Top" | "Bottom")[]; sections?: PositionSection[] },
): string {
  const r = e.raw;
  const want = (s: PositionSection) => !opts.sections || opts.sections.length === 0 || opts.sections.includes(s);
  const lines = [`# ${e.name} [position]`];
  if (e.aliases.length) lines.push(`Also called: ${e.aliases.join(", ")}`);
  if (str(r.summary)) lines.push("", str(r.summary));
  if (str(r.variant_uniqueness)) lines.push(`Distinctive: ${str(r.variant_uniqueness)}`);
  lines.push(...block("Variations", arr(r.variations).map((v) => `${str(obj(v).name)} — ${str(obj(v).description)}`)));
  lines.push(...block("Not to be confused with", r.disambiguations));
  if (want("principles")) lines.push(...block("Key principles", r.key_principles));
  if (want("related")) lines.push(...block("Related positions", r.related_positions));

  for (const role of opts.roles) {
    const side = obj(r[role.toLowerCase()]);
    const state = `${e.name}/${role}`;
    lines.push("", `# ${state.toUpperCase()}`);
    if (want("overview")) lines.push(...block("Overview", side.overview));
    if (want("properties")) {
      lines.push(...block("State properties", side.state_properties));
      lines.push(...block("Position metrics", side.position_metrics));
      lines.push(...block("Prerequisites", side.prerequisites));
      lines.push(...block("State invariants", side.state_invariants));
    }
    if (want("principles")) lines.push(...block("Key principles", side.key_principles));
    if (want("decisions")) lines.push(...block("Decision tree", side.decision_tree));
    if (want("errors")) lines.push(...withHeading("Common errors", errorLines(arr(side.common_errors))));
    if (want("drills")) lines.push(...block("Training drills", side.training_drills));
    if (want("menu")) {
      const menu = arr(side.transitions).map(obj);
      if (menu.length) {
        lines.push(
          "",
          `## Techniques from ${state} (attempt weight; details via bjj_position_options)`,
          menu.map((t) => `${str(t.transition)} (${pct(obj(t.attempt_probability) as Probability)})`).join("; "),
        );
      }
    }
    if (want("related")) lines.push(...block("Related", side.related_content));
    if (want("clips")) lines.push(...block("Clips", side.clips));
  }
  if (want("clips")) lines.push(...block("Clips", r.clips));
  return lines.join("\n");
}

const CONCEPT_SKIP = new Set(["name", "tags", "description", "summary", "aliases", "display_title"]);

export function renderConcept(e: Entry): string {
  const r = e.raw;
  const lines = [`# ${e.name} [${e.kind}]`];
  if (str(r.display_title) && str(r.display_title) !== e.name) lines.push(str(r.display_title));
  if (e.aliases.length) lines.push(`Also called: ${e.aliases.join(", ")}`);
  if (e.summary) lines.push("", e.summary);
  // Put the long prose last so the structured parts survive the first page.
  const keys = Object.keys(r).filter((k) => !CONCEPT_SKIP.has(k));
  const facts = keys.filter((k) => typeof r[k] === "string" && k !== "overview" && str(r[k]).length < 80);
  if (facts.length) lines.push(facts.map((k) => `${title(k)}: ${str(r[k])}`).join(" · "));
  const rest = keys.filter((k) => !facts.includes(k));
  const ordered = [...rest.filter((k) => k !== "overview"), ...rest.filter((k) => k === "overview")];
  for (const k of ordered) lines.push(...block(title(k), r[k]));
  return lines.join("\n");
}

export function moveLine(m: Move, ruleset: Ruleset): string {
  const outs = m.outcomes.map((o) => `${o.result} → ${o.to} ${pct(o.p, ruleset)}`).join("; ");
  const attempt = m.attempt ? `attempted ${pct(m.attempt, ruleset)}, ` : "";
  return `- ${m.entry.name} [${m.entry.kind}] (${attempt}success ${pct(m.success, ruleset)}): ${outs}`;
}

/** Splits text into pages of at most maxChars (on line boundaries) and returns one page with a footer. */
export function paginate(text: string, page: number, maxChars: number): string {
  const pages: string[] = [];
  let current = "";
  const push = () => {
    if (current) pages.push(current);
    current = "";
  };
  for (const rawLine of text.split("\n")) {
    let line = rawLine;
    while (line.length > maxChars) {
      push();
      pages.push(line.slice(0, maxChars));
      line = line.slice(maxChars);
    }
    if (current.length + line.length + 1 > maxChars) push();
    current = current ? `${current}\n${line}` : line;
  }
  push();
  if (pages.length <= 1) return pages[0] ?? "";
  const p = Math.min(Math.max(1, page), pages.length);
  const footer =
    p < pages.length ? `\n\n[page ${p}/${pages.length} — call again with page=${p + 1} for more]` : `\n\n[page ${p}/${pages.length} — end]`;
  return pages[p - 1] + footer;
}

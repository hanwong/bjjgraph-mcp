// Fuzzy name matching over positions, techniques and concepts.
import { norm, type BjjIndex, type Entry, type Kind } from "./data.js";

// A small hand-written Korean → English glossary of common BJJ terms (not BJJGraph data),
// so Korean queries like "하프가드" or "백" still find English names. Longest keys first.
const KO_TERMS: [string, string][] = (
  [
    ["리어네이키드초크", "rear naked choke"],
    ["리어네이키드 초크", "rear naked choke"],
    ["클로즈드가드", "closed guard"],
    ["클로즈드 가드", "closed guard"],
    ["하프가드", "half guard"],
    ["하프 가드", "half guard"],
    ["딥하프", "deep half guard"],
    ["오픈가드", "open guard"],
    ["버터플라이", "butterfly guard"],
    ["스파이더", "spider guard"],
    ["데라히바", "de la riva guard"],
    ["라쏘", "lasso guard"],
    ["엑스가드", "x guard"],
    ["싱글레그엑스", "single leg x"],
    ["사이드컨트롤", "side control"],
    ["사이드 컨트롤", "side control"],
    ["사이드", "side control"],
    ["백컨트롤", "back control"],
    ["백 컨트롤", "back control"],
    ["백테이크", "back take"],
    ["백", "back control"],
    ["마운트", "mount"],
    ["니온벨리", "knee on belly"],
    ["니 온 벨리", "knee on belly"],
    ["노스사우스", "north south"],
    ["거북이", "turtle"],
    ["터틀", "turtle"],
    ["스탠딩", "standing"],
    ["스윕", "sweep"],
    ["패스", "pass"],
    ["탈출", "escape"],
    ["이스케이프", "escape"],
    ["테이크다운", "takedown"],
    ["암바", "armbar"],
    ["트라이앵글", "triangle"],
    ["삼각조르기", "triangle choke"],
    ["기무라", "kimura"],
    ["아메리카나", "americana"],
    ["오모플라타", "omoplata"],
    ["길로틴", "guillotine"],
    ["다스초크", "darce choke"],
    ["다스", "darce"],
    ["아나콘다", "anaconda choke"],
    ["에제키엘", "ezekiel choke"],
    ["힐훅", "heel hook"],
    ["니바", "kneebar"],
    ["토홀드", "toe hold"],
    ["발목", "ankle lock"],
    ["초크", "choke"],
    ["애쉬가라미", "ashi garami"],
    ["아시가라미", "ashi garami"],
  ] as [string, string][]
).sort((a, b) => b[0].length - a[0].length);

const KO_PARTICLES = /(에서|까지|으로|로|을|를|이|가|은|는|의|에|하는|하기|가는|방법|기술)(?=\s|$)/g;

/** Rewrites known Korean BJJ terms into English; other text is left as-is. */
export function translateQuery(q: string): string {
  if (!/[가-힣]/.test(q)) return q;
  let out = q;
  for (const [ko, en] of KO_TERMS) out = out.split(ko).join(` ${en} `);
  return out.replace(KO_PARTICLES, " ").replace(/\s+/g, " ").trim();
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

function dice(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return (2 * common) / (ta.size + tb.size || 1);
}

/** Edit-distance similarity (0..1) counting an adjacent swap as one edit. */
function editSim(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length, 1);
}

const tokenSim = (t: string, n: string) => (n.startsWith(t) ? 1 : Math.max(dice(t, n), editSim(t, n)));

/** 0..100 similarity between a normalized query and a normalized name. */
export function scoreName(q: string, name: string): number {
  if (!q || !name) return 0;
  if (q === name) return 100;
  if (name.startsWith(q)) return 88 - Math.min(10, (name.length - q.length) / 4);
  const qTokens = q.split(" ");
  const nTokens = name.split(" ");
  if (name.includes(q)) return 78 - Math.min(10, (name.length - q.length) / 4);
  const prefixHits = qTokens.filter((t) => nTokens.some((n) => n.startsWith(t))).length;
  if (prefixHits === qTokens.length) return 62 + 10 * (qTokens.length / nTokens.length);
  // Typo tolerance: each query token against its most similar name token.
  const sim = qTokens.reduce((sum, t) => sum + Math.max(...nTokens.map((n) => tokenSim(t, n))), 0) / qTokens.length;
  return Math.round(55 * sim + 25 * dice(q, name));
}

export interface SearchHit {
  entry: Entry;
  score: number;
  matched: string;
}

const MIN_SCORE = 40;

export function search(index: BjjIndex, query: string, kinds?: Kind[]): SearchHit[] {
  const q = norm(translateQuery(query));
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const entry of index.entries) {
    if (kinds && !kinds.includes(entry.kind)) continue;
    let best = 0;
    let matched = entry.name;
    for (const n of [entry.name, ...entry.aliases]) {
      const s = scoreName(q, norm(n)) - (n === entry.name ? 0 : 2);
      if (s > best) {
        best = s;
        matched = n;
      }
    }
    if (best >= MIN_SCORE) hits.push({ entry, score: best, matched });
  }
  const kindRank: Record<Kind, number> = { position: 0, transition: 1, submission: 1, system: 2, principle: 3, learning: 4 };
  return hits.sort(
    (a, b) =>
      b.score - a.score ||
      kindRank[a.entry.kind] - kindRank[b.entry.kind] ||
      a.entry.name.length - b.entry.name.length ||
      a.entry.name.localeCompare(b.entry.name),
  );
}

export type Resolution = { entry: Entry } | { candidates: SearchHit[] };

/** Exact name/alias first, then a clear fuzzy winner; otherwise returns candidates to pick from. */
export function resolve(index: BjjIndex, name: string, kinds: Kind[]): Resolution {
  const exact = index.lookup(translateQuery(name), kinds);
  if (exact.length >= 1) return { entry: exact[0] };
  const hits = search(index, name, kinds);
  if (hits.length === 0) return { candidates: [] };
  if (hits.length === 1 || (hits[0].score >= 60 && hits[0].score - hits[1].score >= 8)) return { entry: hits[0].entry };
  return { candidates: hits.slice(0, 8) };
}

import { describe, expect, it } from "vitest";
import {
  DOT_DELAY_MS,
  LINE_MS,
  MAX_STAGGERED,
  MORPH_MS,
  OPEN_LEAD_MS,
  OPEN_MS,
  STAGGER_MS,
  delayOf,
  durationOf,
  easeOutBack,
  freshCommits,
  openProgress,
  openedAbove,
  progress,
  snapshot,
} from "./appear";
import { layoutGraph } from "./layout";
import type { GraphCommit } from "../types";

function c(oid: string, ...parents: string[]): GraphCommit {
  return { oid, shortOid: oid, summary: oid, authorName: "T", timestamp: 0, parents, refs: [] };
}

/** Un affichage : le layout et ce qu'on en retient. */
function view(repoId: string, commits: GraphCommit[], wipHead: string | null = null) {
  const layout = layoutGraph(commits, wipHead === null ? null : { head: wipHead });
  return { layout, seen: snapshot(repoId, layout) };
}

describe("freshCommits", () => {
  const base = [c("B", "A"), c("A")];

  it("ne trouve rien au premier affichage ni après un changement d'onglet", () => {
    const first = view("r", base);
    expect(freshCommits(null, first.seen, first.layout)).toEqual([]);
    const other = view("autre", [c("X")]);
    expect(freshCommits(first.seen, other.seen, other.layout)).toEqual([]);
  });

  it("anime les commits nouveaux en partant du bas, après un rechargement", () => {
    const before = view("r", base);
    // Rechargement : de nouveaux objets, deux commits de plus en tête.
    const after = view("r", [c("D", "C"), c("C", "B"), c("B", "A"), c("A")]);
    expect(freshCommits(before.seen, after.seen, after.layout)).toEqual([
      { oid: "D", rank: 1, morph: false },
      { oid: "C", rank: 0, morph: false },
    ]);
  });

  it("n'anime pas une page ajoutée par le défilement", () => {
    const before = view("r", base);
    // Même objets en tête, une page de plus au bout.
    const after = view("r", [...before.seen.commits, c("Z")]);
    expect(freshCommits(before.seen, after.seen, after.layout)).toEqual([]);
  });

  it("remplit le cercle WIP quand le commit prend sa place", () => {
    const before = view("r", base, "B");
    const after = view("r", [c("C", "B"), c("B", "A"), c("A")]);
    expect(freshCommits(before.seen, after.seen, after.layout)).toEqual([
      { oid: "C", rank: 0, morph: true },
    ]);
  });

  it("fait apparaître normalement un commit partiel : le cercle WIP reste", () => {
    const before = view("r", base, "B");
    const after = view("r", [c("C", "B"), c("B", "A"), c("A")], "C");
    expect(freshCommits(before.seen, after.seen, after.layout)).toEqual([
      { oid: "C", rank: 0, morph: false },
    ]);
  });
});

describe("minutage", () => {
  it("décale les rangées, mais pas au-delà d'un plafond", () => {
    expect(delayOf({ oid: "x", rank: 0, morph: false })).toBe(OPEN_LEAD_MS);
    expect(delayOf({ oid: "x", rank: 2, morph: false })).toBe(OPEN_LEAD_MS + 2 * STAGGER_MS);
    expect(delayOf({ oid: "x", rank: 500, morph: false })).toBe(
      OPEN_LEAD_MS + MAX_STAGGERED * STAGGER_MS,
    );
    expect(delayOf({ oid: "x", rank: 3, morph: true })).toBe(0);
  });

  it("ne montre rien avant le départ, et tout à la fin", () => {
    expect(progress(-50, false)).toEqual({ reveal: 0, dot: 0, alpha: 0 });
    expect(progress(DOT_DELAY_MS, false).alpha).toBe(0);
    const end = progress(durationOf(false), false);
    expect(end.reveal).toBe(1);
    expect(end.dot).toBeCloseTo(1);
    expect(end.alpha).toBe(1);
    expect(progress(LINE_MS, false).reveal).toBe(1);
    expect(progress(MORPH_MS, true)).toEqual({ reveal: 1, dot: 1, alpha: 1 });
  });

  it("ouvre la place en douceur, et fait glisser ce qui est dessous", () => {
    expect(openProgress(0)).toBe(0);
    expect(openProgress(OPEN_MS / 2)).toBeCloseTo(0.5);
    expect(openProgress(OPEN_MS)).toBe(1);
    expect(openProgress(OPEN_LEAD_MS)).toBeGreaterThan(0.95);
    // Rangées 1 et 4 nouvelles : la 3 vient d'un cran plus haut, la 6 de deux.
    expect(openedAbove([1, 4], 0)).toBe(0);
    expect(openedAbove([1, 4], 1)).toBe(0);
    expect(openedAbove([1, 4], 3)).toBe(1);
    expect(openedAbove([1, 4], 6)).toBe(2);
  });

  it("fait déborder le point un instant : le rebond", () => {
    const peak = Math.max(...Array.from({ length: 50 }, (_, i) => easeOutBack(i / 49)));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.06);
    expect(easeOutBack(1)).toBeCloseTo(1);
  });
});

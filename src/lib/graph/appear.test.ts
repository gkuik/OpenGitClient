import { describe, expect, it } from "vitest";
import {
  DOT_MS,
  LINE_MS,
  MAX_CLIMB_MS,
  MORPH_MS,
  OPEN_LEAD_MS,
  OPEN_MS,
  climb,
  dotProgress,
  easeOutBack,
  freshCommits,
  morphProgress,
  movedLocalRefs,
  movedRemoteRefs,
  newLocalBranches,
  PULSE_MS,
  pulseProgress,
  openProgress,
  openedAbove,
  snapshot,
  trailFront,
  trailsOf,
} from "./appear";
import { layoutGraph } from "./layout";
import type { GraphCommit, GraphRef } from "../types";

function c(oid: string, ...parents: string[]): GraphCommit {
  return { oid, shortOid: oid, summary: oid, authorName: "T", timestamp: 0, parents, refs: [] };
}

/** Le même commit, portant des références. */
function at(commit: GraphCommit, ...refs: GraphRef[]): GraphCommit {
  return { ...commit, refs };
}
const local = (name: string): GraphRef => ({ name, kind: "localBranch" });
const remote = (name: string): GraphRef => ({ name, kind: "remoteBranch" });

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

  it("trouve les commits nouveaux après un rechargement", () => {
    const before = view("r", base);
    // Rechargement : de nouveaux objets, deux commits de plus en tête.
    const after = view("r", [c("D", "C"), c("C", "B"), c("B", "A"), c("A")]);
    expect(freshCommits(before.seen, after.seen, after.layout)).toEqual([
      { oid: "D", morph: false },
      { oid: "C", morph: false },
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
      { oid: "C", morph: true },
    ]);
  });

  it("fait apparaître normalement un commit partiel : le cercle WIP reste", () => {
    const before = view("r", base, "B");
    const after = view("r", [c("C", "B"), c("B", "A"), c("A")], "C");
    expect(freshCommits(before.seen, after.seen, after.layout)).toEqual([
      { oid: "C", morph: false },
    ]);
  });
});

describe("movedRemoteRefs", () => {
  it("push : la branche distante rejoint le commit local publié", () => {
    const before = view("r", [at(c("L", "O"), local("main")), at(c("O"), remote("origin/main"))]);
    const after = view("r", [at(c("L", "O"), local("main"), remote("origin/main")), c("O")]);
    expect(movedRemoteRefs(before.seen, after.seen)).toEqual([
      { name: "origin/main", from: "O", to: "L" },
    ]);
  });

  it("premier push : la branche distante apparaît sur place", () => {
    const before = view("r", [at(c("L"), local("feat"))]);
    const after = view("r", [at(c("L"), local("feat"), remote("origin/feat"))]);
    expect(movedRemoteRefs(before.seen, after.seen)).toEqual([
      { name: "origin/feat", from: null, to: "L" },
    ]);
  });

  it("ne voit rien bouger d'un rechargement à l'identique, ni d'un onglet à l'autre", () => {
    const history = () => [at(c("L", "O"), local("main")), at(c("O"), remote("origin/main"))];
    const before = view("r", history());
    expect(movedRemoteRefs(before.seen, view("r", history()).seen)).toEqual([]);
    expect(movedRemoteRefs(before.seen, view("autre", history()).seen)).toEqual([]);
  });
});

describe("movedLocalRefs", () => {
  const head = (name: string): GraphRef => ({ name, kind: "head" });

  it("commit : la branche courante avance d'un cran", () => {
    const before = view("r", [at(c("B", "A"), head("main")), c("A")]);
    const after = view("r", [at(c("C", "B"), head("main")), c("B", "A"), c("A")]);
    expect(movedLocalRefs(before.seen, after.seen)).toEqual([{ name: "main", from: "B", to: "C" }]);
  });

  it("avance rapide d'une branche inactive, sans toucher aux autres", () => {
    const before = view("r", [at(c("C", "B"), head("develop")), c("B", "A"), at(c("A"), local("main"))]);
    const after = view("r", [at(c("C", "B"), head("develop"), local("main")), c("B", "A"), c("A")]);
    expect(movedLocalRefs(before.seen, after.seen)).toEqual([{ name: "main", from: "A", to: "C" }]);
  });

  it("ancien commit plus affiché : la branche se pose sur place", () => {
    const before = view("r", [at(c("B", "A"), local("x")), c("A")]);
    const after = view("r", [at(c("Z"), local("x"))]);
    expect(movedLocalRefs(before.seen, after.seen)).toEqual([{ name: "x", from: null, to: "Z" }]);
  });

  it("une naissance n'est pas un déplacement, ni un checkout, ni un autre onglet", () => {
    const before = view("r", [at(c("B", "A"), head("main")), at(c("A"), local("old"))]);
    // Checkout de `old` : HEAD change de branche, aucune ne change de commit.
    const checkout = view("r", [at(c("B", "A"), local("main")), at(c("A"), head("old"))]);
    expect(movedLocalRefs(before.seen, checkout.seen)).toEqual([]);
    const born = view("r", [at(c("B", "A"), head("main"), local("neuve")), at(c("A"), local("old"))]);
    expect(movedLocalRefs(before.seen, born.seen)).toEqual([]);
    const other = view("autre", [at(c("C", "B"), head("main")), c("B", "A"), c("A")]);
    expect(movedLocalRefs(before.seen, other.seen)).toEqual([]);
  });
});

describe("newLocalBranches", () => {
  const head = (name: string): GraphRef => ({ name, kind: "head" });

  it("trouve la branche créée, courante ou non, et le commit où elle naît", () => {
    const before = view("r", [at(c("B", "A"), head("main")), c("A")]);
    const after = view("r", [at(c("B", "A"), local("main"), head("feat/x")), at(c("A"), local("old"))]);
    expect(newLocalBranches(before.seen, after.seen)).toEqual([
      { name: "feat/x", at: "B" },
      { name: "old", at: "A" },
    ]);
  });

  it("ne voit rien naître d'une branche qui avance, ni d'un onglet à l'autre", () => {
    const before = view("r", [at(c("B", "A"), head("main")), c("A")]);
    const moved = view("r", [at(c("C", "B"), head("main")), c("B", "A"), c("A")]);
    expect(newLocalBranches(before.seen, moved.seen)).toEqual([]);
    const other = view("autre", [at(c("B", "A"), head("x")), c("A")]);
    expect(newLocalBranches(before.seen, other.seen)).toEqual([]);
  });

  it("élargit l'onde en l'éteignant, puis plus rien", () => {
    expect(pulseProgress(0)).toEqual({ radius: 0, alpha: 1 });
    expect(pulseProgress(PULSE_MS / 2).alpha).toBeCloseTo(0.5);
    expect(pulseProgress(PULSE_MS)).toEqual({ radius: 0, alpha: 0 });
  });
});

describe("lignes nouvelles", () => {
  it("chaîne : chaque commit tire une ligne vers son parent, qui l'attend s'il est nouveau", () => {
    const { layout } = view("r", [c("C2", "C1"), c("C1", "B"), c("B")]);
    const fresh = new Set(["C2", "C1"]);
    const trails = trailsOf(layout, fresh);
    expect(trails.list).toEqual([
      { child: "C2", top: 0.5, bottom: 1.5, from: "C1" },
      { child: "C1", top: 1.5, bottom: 2.5, from: null },
    ]);
    // La ligne de C1 vers B est son `out`, puis le `in` qui arrive sur B.
    expect([...trails.byRow.get("B")!.values()]).toEqual([1]);

    const plan = climb(layout, fresh, trails);
    expect(plan.arrive.get("C1")).toBe(LINE_MS);
    expect(plan.arrive.get("C2")).toBe(2 * LINE_MS);
    expect(plan.msPerRow).toBe(LINE_MS);
  });

  /*
    M ┐        merge de feature dans main
    │ F2
    │ F1
    B │
    A ┘
  */
  const MERGE = [c("M", "B", "F2"), c("F2", "F1"), c("F1", "A"), c("B", "A"), c("A")];

  it("merge : les deux lignes montent de leur parent et arrivent ensemble sur le point", () => {
    const { layout } = view("r", MERGE);
    const fresh = new Set(["M"]);
    const trails = trailsOf(layout, fresh);
    const toB = trails.list.find((t) => t.bottom === 3.5)!;
    const toF2 = trails.list.find((t) => t.bottom === 1.5)!;
    expect(toB).toMatchObject({ child: "M", top: 0.5, from: null });
    expect(toF2).toMatchObject({ child: "M", top: 0.5, from: null });
    // La ligne de main traverse F2 et F1 : ces segments sont nouveaux aussi.
    expect(trails.byRow.get("F2")!.size).toBe(2);
    expect(trails.byRow.get("F1")!.size).toBe(1);

    const plan = climb(layout, fresh, trails);
    // La plus longue (trois rangées) fixe l'arrivée…
    expect(plan.arrive.get("M")).toBe(3 * LINE_MS);
    const at = plan.arrive.get("M")!;
    // …et la courte part plus tard pour arriver en même temps.
    expect(trailFront(toB, -at, plan.msPerRow)).toBe(toB.bottom);
    expect(trailFront(toF2, -at, plan.msPerRow)).toBe(toF2.bottom);
    expect(trailFront(toF2, -LINE_MS, plan.msPerRow)).toBe(toF2.bottom);
    expect(trailFront(toB, -LINE_MS, plan.msPerRow)).toBeCloseTo(1.5);
    expect(trailFront(toB, 0, plan.msPerRow)).toBe(0.5);
    expect(trailFront(toF2, 0, plan.msPerRow)).toBe(0.5);
  });

  it("une ligne qui rejoint une colonne déjà tracée ne redessine que son raccord", () => {
    // X fusionne P, que la colonne de Y attend déjà au-dessus de X.
    const { layout } = view("r", [c("Y", "P"), c("X", "Q", "P"), c("Q"), c("P")]);
    const trails = trailsOf(layout, new Set(["X"]));
    const join = trails.list.find((t) => t.bottom === 2)!;
    expect(join).toEqual({ child: "X", top: 1.5, bottom: 2, from: null });
    // Rien de la colonne de Y sous X n'appartient à la ligne de X.
    expect(trails.byRow.get("P")?.size ?? 0).toBe(0);
  });

  it("accélère un gros fetch : la montée la plus longue reste bornée", () => {
    const chain = Array.from({ length: 30 }, (_, i) =>
      c(`C${30 - i}`, i === 29 ? "B" : `C${29 - i}`),
    );
    const { layout } = view("r", [...chain, c("B")]);
    const fresh = new Set(chain.map((x) => x.oid));
    const plan = climb(layout, fresh, trailsOf(layout, fresh));
    expect(Math.max(...plan.arrive.values())).toBeCloseTo(MAX_CLIMB_MS);
    expect(plan.msPerRow).toBeLessThan(LINE_MS);
  });
});

describe("minutage", () => {
  it("fait apparaître le point quand ses lignes l'atteignent", () => {
    expect(dotProgress(-10)).toEqual({ dot: 0, alpha: 0 });
    expect(dotProgress(0)).toEqual({ dot: 0, alpha: 0 });
    const end = dotProgress(DOT_MS);
    expect(end.dot).toBeCloseTo(1);
    expect(end.alpha).toBe(1);
  });

  it("remplit le cercle WIP : le trait monte, puis le disque suit", () => {
    expect(morphProgress(0)).toEqual({ reveal: 0, dot: 0 });
    expect(morphProgress(MORPH_MS * 0.3).dot).toBe(0);
    expect(morphProgress(MORPH_MS)).toEqual({ reveal: 1, dot: 1 });
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

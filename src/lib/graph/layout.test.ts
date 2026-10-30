import { describe, expect, it } from "vitest";
import { layoutGraph } from "./layout";
import type { GraphCommit, StashEntry } from "../types";

/** Commit minimal : seuls l'oid et les parents comptent pour le placement. */
function c(oid: string, ...parents: string[]): GraphCommit {
  return {
    oid,
    shortOid: oid,
    summary: oid,
    authorName: "Test",
    timestamp: 0,
    parents,
    refs: [],
  };
}

/** Commit daté, pour placer les stashes. */
function ct(oid: string, timestamp: number, ...parents: string[]): GraphCommit {
  return { ...c(oid, ...parents), timestamp };
}

/** Stash minimal : son oid, son commit de base et sa date. */
function st(oid: string, parent: string | null, timestamp: number, index = 0): StashEntry {
  return { index, message: oid, branch: null, oid, parent, timestamp };
}

describe("layoutGraph", () => {
  it("place un historique linéaire sur une seule lane", () => {
    const { rows, laneCount } = layoutGraph([c("A", "B"), c("B", "C"), c("C")]);

    expect(laneCount).toBe(1);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);

    // La tête n'a rien qui descend sur elle, la racine n'a rien qui en repart.
    expect(rows[0].edges.filter((e) => e.kind === "in")).toHaveLength(0);
    expect(rows[0].edges.filter((e) => e.kind === "out")).toHaveLength(1);
    expect(rows[2].edges.filter((e) => e.kind === "in")).toHaveLength(1);
    expect(rows[2].edges.filter((e) => e.kind === "out")).toHaveLength(0);
  });

  it("ouvre une lane par tête et fait converger les branches sur l'ancêtre commun", () => {
    // Deux têtes A et B qui partagent le parent P.
    const { rows, laneCount } = layoutGraph([c("A", "P"), c("B", "P"), c("P")]);

    expect(laneCount).toBe(2);
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 0]);

    // Pendant la rangée de B, la lane 0 (qui attend P) ne fait que traverser.
    expect(rows[1].edges).toContainEqual({
      fromLane: 0,
      toLane: 0,
      color: 0,
      kind: "through",
    });

    // Sur P, les deux lanes aboutissent au même point.
    const incoming = rows[2].edges.filter((e) => e.kind === "in");
    expect(incoming.map((e) => e.fromLane).sort()).toEqual([0, 1]);
    expect(incoming.every((e) => e.toLane === 0)).toBe(true);
  });

  it("ouvre une lane pour le second parent d'un merge", () => {
    const { rows, laneCount } = layoutGraph([c("M", "P1", "P2"), c("P1"), c("P2")]);

    expect(laneCount).toBe(2);

    // Le merge repart vers sa lane (premier parent) et vers une lane neuve.
    const out = rows[0].edges.filter((e) => e.kind === "out");
    expect(out.map((e) => e.toLane)).toEqual([0, 1]);
    expect(rows[0].lane).toBe(0);

    // P1 reste en lane 0, P2 récupère la lane ouverte pour lui.
    expect(rows[1].lane).toBe(0);
    expect(rows[2].lane).toBe(1);

    // Tant que P2 n'est pas atteint, sa lane traverse la rangée de P1.
    expect(rows[1].edges).toContainEqual({
      fromLane: 1,
      toLane: 1,
      color: 1,
      kind: "through",
    });
  });

  it("réutilise la lane d'une branche terminée", () => {
    // Y est une racine isolée : sa lane se libère et W la récupère.
    const { rows, laneCount } = layoutGraph([
      c("X", "Z"),
      c("Y"),
      c("W", "Z"),
      c("Z"),
    ]);

    expect(rows.map((r) => r.lane)).toEqual([0, 1, 1, 0]);
    expect(laneCount).toBe(2);

    // Z fait converger X (lane 0) et W (lane 1).
    const incoming = rows[3].edges.filter((e) => e.kind === "in");
    expect(incoming.map((e) => e.fromLane).sort()).toEqual([0, 1]);
  });

  it("renvoie un layout vide sans commit", () => {
    expect(layoutGraph([])).toEqual({ rows: [], laneCount: 0 });
  });

  it("place la rangée WIP en tête et la raccorde à HEAD", () => {
    const { rows, laneCount } = layoutGraph([c("A", "B"), c("B")], { head: "A" });

    expect(laneCount).toBe(1);
    expect(rows.map((r) => r.kind)).toEqual(["wip", "commit", "commit"]);

    // Rien ne descend sur le nœud WIP ; un seul segment en repart, vers HEAD.
    expect(rows[0].edges).toEqual([
      { fromLane: 0, toLane: 0, color: 0, kind: "out", dashed: true },
    ]);
    // Et HEAD le reçoit, comme il recevrait celui d'un enfant — en pointillés,
    // puisque c'est encore la ligne des modifications en cours.
    expect(rows[1].edges).toContainEqual({
      fromLane: 0,
      toLane: 0,
      color: 0,
      kind: "in",
      dashed: true,
    });
    // Ce qui repart de HEAD est l'historique ordinaire : trait plein.
    expect(rows[1].edges.filter((e) => e.kind === "out")).toEqual([
      { fromLane: 0, toLane: 0, color: 0, kind: "out" },
    ]);
  });

  it("réserve la colonne de HEAD dès le haut quand ce n'est pas le premier commit", () => {
    // A est la tête d'une autre branche, listée avant le commit de HEAD.
    const { rows } = layoutGraph([c("A", "P"), c("H", "P"), c("P")], { head: "H" });

    // La branche courante prend la colonne 0, l'autre est repoussée à droite.
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 0, 0]);

    // La rangée de A n'est que traversée par la ligne qui descend vers HEAD,
    // en pointillés d'un bout à l'autre ; la colonne de A, elle, reste pleine.
    expect(rows[1].edges).toContainEqual({
      fromLane: 0,
      toLane: 0,
      color: 0,
      kind: "through",
      dashed: true,
    });
    expect(rows[1].edges.filter((e) => e.fromLane === 1).every((e) => !e.dashed)).toBe(true);
    // La ligne aboutit en pointillés sur HEAD (rangée 2) ; ce qui en repart, et
    // tout ce qui est en dessous, est en trait plein.
    expect(rows[2].edges.find((e) => e.kind === "in" && e.fromLane === 0)?.dashed).toBe(true);
    expect(rows[2].edges.filter((e) => e.kind === "out").some((e) => e.dashed)).toBe(false);
    expect(rows.slice(3).flatMap((r) => r.edges).some((e) => e.dashed)).toBe(false);
  });

  it("pose le nœud WIP seul sur un dépôt sans commit", () => {
    const { rows, laneCount } = layoutGraph([], { head: null });

    expect(laneCount).toBe(1);
    expect(rows).toEqual([{ kind: "wip", lane: 0, color: 0, edges: [] }]);
  });

  describe("stashes", () => {
    it("place un stash à sa date, dans une colonne à lui, relié à sa base en pointillés", () => {
      // H ← A ← B : le stash S a été créé sur H, avant A.
      const commits = [ct("B", 30, "A"), ct("A", 20, "H"), ct("H", 10)];
      const { rows, laneCount } = layoutGraph(commits, null, null, [st("S", "H", 15)]);

      expect(rows.map((r) => r.kind)).toEqual(["commit", "commit", "stash", "commit"]);
      // La branche garde sa colonne ; le stash prend la suivante.
      expect(rows.map((r) => r.lane)).toEqual([0, 0, 1, 0]);
      expect(laneCount).toBe(2);

      // Sa ligne part en pointillés et aboutit, en pointillés, sur H.
      expect(rows[2].edges.find((e) => e.kind === "out")).toMatchObject({ fromLane: 1, toLane: 1, dashed: true });
      expect(rows[3].edges.find((e) => e.kind === "in" && e.fromLane === 1)).toMatchObject({ toLane: 0, dashed: true });
      // La branche, elle, reste en trait plein.
      expect(rows[3].edges.find((e) => e.kind === "in" && e.fromLane === 0)?.dashed).toBeUndefined();
    });

    it("ne descend jamais sous son commit de base, même plus ancien que lui", () => {
      // Horloges décalées : le stash paraît plus vieux que sa base.
      const { rows } = layoutGraph([ct("A", 20, "H"), ct("H", 10, "R"), ct("R", 5)], null, null, [
        st("S", "H", 1),
      ]);
      expect(rows.map((r) => (r.kind === "stash" ? "S" : r.kind === "commit" ? r.commit.oid : "wip"))).toEqual([
        "A",
        "S",
        "H",
        "R",
      ]);
    });

    it("n'affiche pas un stash dont la base n'est pas chargée", () => {
      const { rows } = layoutGraph([ct("A", 20)], null, null, [st("S", "X", 30), st("T", null, 30)]);
      expect(rows.map((r) => r.kind)).toEqual(["commit"]);
    });

    it("range plusieurs stashes au même endroit du plus récent au plus ancien", () => {
      const { rows } = layoutGraph([ct("H", 10)], null, null, [st("S1", "H", 20, 1), st("S0", "H", 30, 0)]);
      expect(rows.map((r) => (r.kind === "stash" ? r.stash.oid : r.kind))).toEqual(["S0", "S1", "commit"]);
    });

    it("se place sous la rangée WIP, qui garde la colonne de HEAD", () => {
      const { rows } = layoutGraph([ct("H", 10)], { head: "H" }, null, [st("S", "H", 20)]);

      expect(rows.map((r) => r.kind)).toEqual(["wip", "stash", "commit"]);
      expect(rows.map((r) => r.lane)).toEqual([0, 1, 0]);
      // Les deux lignes en pointillés aboutissent sur HEAD.
      const incoming = rows[2].edges.filter((e) => e.kind === "in");
      expect(incoming.map((e) => e.fromLane).sort()).toEqual([0, 1]);
      expect(incoming.every((e) => e.dashed)).toBe(true);
    });

    it("prend la colonne du commit quand rien d'autre ne l'attend", () => {
      // Stash sur la pointe d'une branche, sans WIP : la base s'aligne dessous.
      const { rows } = layoutGraph([ct("H", 10)], null, null, [st("S", "H", 20)]);
      expect(rows.map((r) => r.lane)).toEqual([0, 0]);
      expect(rows[1].edges.find((e) => e.kind === "in")?.dashed).toBe(true);
    });

    it("ne prête pas sa ligne au second parent d'un merge", () => {
      // M fusionne P2, la base du stash : sa ligne vers P2 reste pleine.
      const commits = [ct("M", 30, "P1", "P2"), ct("P1", 20, "P2"), ct("P2", 10)];
      const { rows } = layoutGraph(commits, null, null, [st("S", "P2", 40)]);
      expect(rows[0].kind).toBe("stash");
      const mergeOut = rows[1].edges.filter((e) => e.kind === "out");
      expect(mergeOut.some((e) => e.dashed)).toBe(false);
      expect(mergeOut.map((e) => e.toLane)).not.toContain(rows[0].lane);
    });
  });
});

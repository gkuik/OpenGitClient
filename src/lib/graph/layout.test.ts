import { describe, expect, it } from "vitest";
import { layoutGraph } from "./layout";
import type { GraphCommit } from "../types";

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
      { fromLane: 0, toLane: 0, color: 0, kind: "out" },
    ]);
    // Et HEAD le reçoit, comme il recevrait celui d'un enfant.
    expect(rows[1].edges).toContainEqual({
      fromLane: 0,
      toLane: 0,
      color: 0,
      kind: "in",
    });
  });

  it("réserve la colonne de HEAD dès le haut quand ce n'est pas le premier commit", () => {
    // A est la tête d'une autre branche, listée avant le commit de HEAD.
    const { rows } = layoutGraph([c("A", "P"), c("H", "P"), c("P")], { head: "H" });

    // La branche courante prend la colonne 0, l'autre est repoussée à droite.
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 0, 0]);

    // La rangée de A n'est que traversée par la ligne qui descend vers HEAD.
    expect(rows[1].edges).toContainEqual({
      fromLane: 0,
      toLane: 0,
      color: 0,
      kind: "through",
    });
  });

  it("pose le nœud WIP seul sur un dépôt sans commit", () => {
    const { rows, laneCount } = layoutGraph([], { head: null });

    expect(laneCount).toBe(1);
    expect(rows).toEqual([{ kind: "wip", lane: 0, color: 0, edges: [] }]);
  });
});

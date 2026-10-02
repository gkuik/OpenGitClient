import { describe, expect, it } from "vitest";
import {
  defaultFlowConfig,
  defaultTag,
  flowBands,
  flowBranchName,
  flowKindOf,
  flowTargets,
  matchesEntry,
  resolveTip,
} from "./gitflow";
import { layoutGraph } from "./graph/layout";
import type { BranchEntry, GraphCommit, RemoteBranchEntry } from "./types";

function c(oid: string, ...parents: string[]): GraphCommit {
  return { oid, shortOid: oid, summary: oid, authorName: "T", timestamp: 0, parents, refs: [] };
}

function local(name: string, oid: string): BranchEntry {
  return { name, oid, isHead: false, upstream: null };
}

function remote(name: string, oid: string): RemoteBranchEntry {
  return { name, remote: name.split("/")[0], oid };
}

/*
  M2 ─────────── main
  │  D2 ──────── develop
  │  │  F1 ───── feature/x
  │  D1 ┘
  M1 ┘
*/
const HISTORY = [c("F1", "D1"), c("D2", "D1"), c("M2", "M1"), c("D1", "M1"), c("M1")];
const TIPS = [
  { name: "main", oid: "M2" },
  { name: "develop", oid: "D2" },
  { name: "feature/x", oid: "F1" },
];

describe("flowKindOf / flowBranchName", () => {
  it("reconnaît une branche de travail à son préfixe, jamais au préfixe seul", () => {
    expect(flowKindOf("feature/login")).toBe("feature");
    expect(flowKindOf("hotfix/1.2.1")).toBe("hotfix");
    expect(flowKindOf("feature/")).toBeNull();
    expect(flowKindOf("develop")).toBeNull();
    expect(flowKindOf(null)).toBeNull();
  });

  it("préfixe le nom tapé et remplace les blancs par des tirets", () => {
    expect(flowBranchName("feature", "  new login page ")).toBe("feature/new-login-page");
  });

  it("propose un tag en v pour une version numérotée", () => {
    expect(defaultTag("release/1.2.0")).toBe("v1.2.0");
    expect(defaultTag("hotfix/v1.2.1")).toBe("v1.2.1");
    expect(defaultTag("release/spring")).toBe("spring");
  });

  it("ramène release et hotfix en production puis dans develop", () => {
    const config = defaultFlowConfig(["main", "develop"]);
    expect(flowTargets("release", config)).toEqual(["main", "develop"]);
    expect(flowTargets("feature", config)).toEqual(["develop"]);
  });
});

describe("defaultFlowConfig", () => {
  it("déduit les branches pérennes de celles qui existent", () => {
    const config = defaultFlowConfig(["master", "dev", "feature/a"]);
    expect(config.main).toBe("master");
    expect(config.develop).toBe("dev");
    expect(config.order).toEqual(["master", "stage", "dev", "release/*", "hotfix/*"]);
    expect(config.enabled).toBe(false);
  });

  it("garde main et develop quand rien ne correspond", () => {
    const config = defaultFlowConfig([]);
    expect([config.main, config.develop]).toEqual(["main", "develop"]);
  });
});

describe("matchesEntry / resolveTip", () => {
  it("distingue un nom exact d'un groupe", () => {
    expect(matchesEntry("release/*", "release/1.0")).toBe(true);
    expect(matchesEntry("release/*", "releases")).toBe(false);
    expect(matchesEntry("stage", "stage")).toBe(true);
    expect(matchesEntry("stage", "stage2")).toBe(false);
  });

  it("préfère la branche locale, puis origin", () => {
    const remotes = [remote("upstream/develop", "U"), remote("origin/develop", "O")];
    expect(resolveTip("develop", [local("develop", "L")], remotes)).toEqual({ oid: "L", from: "develop" });
    expect(resolveTip("develop", [], remotes)).toEqual({ oid: "O", from: "origin/develop" });
    expect(resolveTip("stage", [], remotes)).toBeNull();
  });
});

describe("flowBands", () => {
  it("donne à chaque branche sa chaîne de premiers parents, l'histoire commune à la plus à gauche", () => {
    const { bandOf, count } = flowBands(HISTORY, TIPS, ["main", "stage", "develop"]);
    expect(count).toBe(3);
    expect(bandOf.get("M2")).toBe(0);
    expect(bandOf.get("M1")).toBe(0);
    expect(bandOf.get("D2")).toBe(2);
    expect(bandOf.get("D1")).toBe(2);
    // Une feature n'est dans aucune entrée : bande libre.
    expect(bandOf.has("F1")).toBe(false);
  });

  it("fait réclamer les noms exacts avant les groupes", () => {
    // La release part de D1 : placée avant develop dans l'ordre, elle ne doit
    // pas emporter l'histoire de develop sous son point de départ.
    const history = [c("R1", "D1"), c("D2", "D1"), c("D1", "M1"), c("M1")];
    const tips = [
      { name: "main", oid: "M1" },
      { name: "develop", oid: "D2" },
      { name: "release/1.0", oid: "R1" },
    ];
    const { bandOf } = flowBands(history, tips, ["main", "release/*", "develop"]);
    expect(bandOf.get("R1")).toBe(1);
    expect(bandOf.get("D1")).toBe(2);
  });

  it("range les colonnes : main, puis develop, puis les features", () => {
    const bands = flowBands(HISTORY, TIPS, ["main", "stage", "develop"]);
    const { rows, laneCount } = layoutGraph(HISTORY, null, bands);
    const lane = (oid: string) =>
      rows.find((r) => r.kind === "commit" && r.commit.oid === oid)!.lane;
    expect(lane("M2")).toBe(0);
    expect(lane("M1")).toBe(0);
    // `stage` n'existe pas : sa bande n'a aucune largeur.
    expect(lane("D2")).toBe(1);
    expect(lane("D1")).toBe(1);
    expect(lane("F1")).toBe(2);
    expect(laneCount).toBe(3);

    // Sans bandes, la feature, tête la plus haute, prend la colonne 0.
    const plain = layoutGraph(HISTORY);
    expect(plain.rows[0].lane).toBe(0);
  });

  it("place la rangée WIP dans la bande de HEAD", () => {
    const bands = flowBands(HISTORY, TIPS, ["main", "develop"]);
    const { rows } = layoutGraph(HISTORY, { head: "D2" }, bands);
    expect(rows[0].kind).toBe("wip");
    expect(rows[0].lane).toBe(1);
  });

  it("colore chaque segment d'après sa colonne finale", () => {
    const bands = flowBands(HISTORY, TIPS, ["main", "develop"]);
    const { rows } = layoutGraph(HISTORY, null, bands);
    for (const row of rows) {
      expect(row.color).toBe(row.lane);
      for (const e of row.edges) {
        expect(e.color).toBe(e.kind === "out" ? e.toLane : e.fromLane);
      }
    }
  });
});

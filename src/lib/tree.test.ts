import { describe, expect, it } from "vitest";
import { buildRemoteTree } from "./tree";
import type { RemoteBranchEntry } from "./types";

function branch(name: string, remote: string): RemoteBranchEntry {
  return { name, remote, oid: "0".repeat(40) };
}

describe("buildRemoteTree", () => {
  it("regroupe par distant, dans l'ordre alphabétique", () => {
    const groups = buildRemoteTree([
      branch("upstream/main", "upstream"),
      branch("origin/main", "origin"),
      branch("origin/dev", "origin"),
    ]);

    expect(groups.map((g) => g.remote)).toEqual(["origin", "upstream"]);
    expect(groups[0].branches).toHaveLength(2);
  });

  it("retire le préfixe du distant de l'affichage mais le garde dans les chemins", () => {
    const [group] = buildRemoteTree([
      branch("origin/feature/x", "origin"),
      branch("origin/main", "origin"),
    ]);

    // Le nœud du distant n'est pas dans l'arbre : il est porté par le groupe.
    expect(group.nodes.map((n) => n.name)).toEqual(["feature", "main"]);

    const dir = group.nodes[0];
    if (dir.type !== "dir") throw new Error("« feature » devrait être un dossier");
    // Le chemin garde le préfixe : les clés de pliage ne peuvent pas entrer en
    // collision avec celles de la section LOCAL.
    expect(dir.path).toBe("origin/feature");
    expect(dir.children.map((n) => n.name)).toEqual(["x"]);
  });

  it("gère un nom de distant contenant un « / »", () => {
    const [group] = buildRemoteTree([branch("mon/distant/main", "mon/distant")]);

    expect(group.remote).toBe("mon/distant");
    expect(group.nodes.map((n) => n.name)).toEqual(["main"]);
  });
});

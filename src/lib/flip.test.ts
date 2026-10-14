import { describe, expect, it } from "vitest";
import { matchRows, type RowBox } from "./flip";

const row = (key: string, section: string, top: number, left = 0): RowBox => ({
  key,
  section,
  left,
  top,
});

describe("matchRows", () => {
  it("fait glisser une ligne restée dans sa section depuis sa place d'avant", () => {
    const before = [row("f:a", "u", 0), row("f:b", "u", 20)];
    const after = [row("f:b", "u", 0)];
    expect(matchRows(before, after)).toEqual([{ kind: "move", dx: 0, dy: 20, crossed: false }]);
  });

  it("reconnaît le fichier qui change de section, et le signale", () => {
    const before = [row("f:a", "u", 100)];
    const after = [row("f:a", "s", 300)];
    expect(matchRows(before, after)).toEqual([{ kind: "move", dx: 0, dy: -200, crossed: true }]);
  });

  it("fait apparaître ce qui n'était nulle part", () => {
    expect(matchRows([], [row("f:neuf", "u", 0)])).toEqual([{ kind: "enter" }]);
  });

  it("laisse à chacune sa ligne quand un fichier est dans les deux sections", () => {
    // `a` est en partie indexé : une ligne dans chaque section. Indexer le
    // reste ne garde que celle du bas — qui ne vient pas d'en haut.
    const before = [row("f:a", "u", 0), row("f:a", "s", 200)];
    const after = [row("f:a", "s", 180)];
    expect(matchRows(before, after)).toEqual([{ kind: "move", dx: 0, dy: 20, crossed: false }]);
  });

  it("ne laisse pas la ligne qui change de section voler celle qui reste", () => {
    // Dans l'ordre du DOM, la ligne « s » nouvelle vient avant la « u » restée :
    // l'appariement par section doit être fini avant de passer d'une section
    // à l'autre.
    const before = [row("f:a", "u", 0)];
    const after = [row("f:a", "s", 300), row("f:a", "u", 10)];
    expect(matchRows(before, after)).toEqual([
      { kind: "enter" },
      { kind: "move", dx: 0, dy: -10, crossed: false },
    ]);
  });

  it("distingue un dossier d'un fichier de même chemin", () => {
    const before = [row("d:src", "u", 0)];
    const after = [row("f:src", "u", 0)];
    expect(matchRows(before, after)).toEqual([{ kind: "enter" }]);
  });
});

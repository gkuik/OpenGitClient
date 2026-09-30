import { describe, expect, it } from "vitest";
import {
  COLUMN_IDS,
  COL_W_MAX,
  DEFAULT_COLUMNS,
  DEFAULT_WIDTHS,
  MESSAGE_MIN_REM,
  dropIndex,
  moveColumn,
  normalizeColumns,
  placeColumns,
  type ColumnId,
  type PlacedColumn,
} from "./columns";

describe("normalizeColumns", () => {
  it("donne l'ordre par défaut à une disposition vide", () => {
    expect(normalizeColumns({})).toEqual(DEFAULT_COLUMNS);
  });

  it("écarte inconnues et doublons, rajoute les manquantes en fin", () => {
    const cols = normalizeColumns({ order: ["sha", "bogus", "sha", "message"] });
    expect(cols.order).toEqual(["sha", "message", "refs", "graph", "author", "date"]);
  });

  it("ne masque ni ne dimensionne jamais le message", () => {
    const cols = normalizeColumns({ hidden: ["message", "date"], widths: { message: 10 } });
    expect(cols.hidden).toEqual(["date"]);
    expect(cols.widths).toEqual({});
  });

  it("borne les largeurs et écarte celles qui ne sont pas des nombres finis", () => {
    const cols = normalizeColumns({ widths: { author: 400, date: "5", sha: NaN } });
    expect(cols.widths).toEqual({ author: COL_W_MAX });
  });
});

describe("placeColumns", () => {
  const opts = { availablePx: 1000, rootPx: 10, graphAutoPx: 60 };

  it("donne au message la largeur restante", () => {
    const placed = placeColumns(DEFAULT_COLUMNS, opts);
    const fixed =
      (DEFAULT_WIDTHS.refs + DEFAULT_WIDTHS.author + DEFAULT_WIDTHS.date + DEFAULT_WIDTHS.sha) * 10 + 60;
    expect(placed.find((c) => c.id === "message")!.width).toBeCloseTo(1000 - fixed);
    // Les colonnes se suivent sans trou.
    placed.slice(1).forEach((c, i) => expect(c.x).toBeCloseTo(placed[i].x + placed[i].width));
  });

  it("ajuste le graph tant qu'aucune largeur n'est choisie, puis la respecte", () => {
    expect(placeColumns(DEFAULT_COLUMNS, opts).find((c) => c.id === "graph")!.width).toBe(60);
    const sized = { ...DEFAULT_COLUMNS, widths: { graph: 3 } };
    expect(placeColumns(sized, opts).find((c) => c.id === "graph")!.width).toBe(30);
  });

  it("ne place pas les colonnes masquées", () => {
    const placed = placeColumns({ ...DEFAULT_COLUMNS, hidden: ["refs", "sha"] }, opts);
    expect(placed.map((c) => c.id)).toEqual(["graph", "message", "author", "date"]);
    expect(placed[0].x).toBe(0);
  });

  it("garde un minimum au message quand la place manque", () => {
    const placed = placeColumns(DEFAULT_COLUMNS, { ...opts, availablePx: 100 });
    expect(placed.find((c) => c.id === "message")!.width).toBe(MESSAGE_MIN_REM * 10);
  });
});

describe("dropIndex", () => {
  // Trois colonnes de largeurs très différentes : 0–40, 40–240, 240–280.
  const placed: PlacedColumn[] = [
    { id: "refs", x: 0, width: 40 },
    { id: "message", x: 40, width: 200 },
    { id: "sha", x: 240, width: 40 },
  ];

  it("ne bouge pas tant que le bord d'attaque n'a pas passé un milieu", () => {
    expect(dropIndex(placed, 2, 230)).toBe(2);
    expect(dropIndex(placed, 0, 50)).toBe(0);
  });

  it("insère avant la colonne dont le milieu est dépassé vers la gauche", () => {
    // Bord gauche de `sha` avant le milieu du message (140).
    expect(dropIndex(placed, 2, 130)).toBe(1);
    expect(dropIndex(placed, 2, 10)).toBe(0);
  });

  it("insère après la colonne dont le milieu est dépassé vers la droite", () => {
    // Bord droit de `refs` au-delà du milieu du message (140).
    expect(dropIndex(placed, 0, 110)).toBe(2);
    expect(dropIndex(placed, 0, 240)).toBe(3);
  });
});

describe("moveColumn", () => {
  const order: ColumnId[] = [...COLUMN_IDS];

  it("place la colonne juste avant la cible", () => {
    expect(moveColumn(order, "sha", "refs")).toEqual(["sha", "refs", "graph", "message", "author", "date"]);
    expect(moveColumn(order, "refs", "author")).toEqual(["graph", "message", "refs", "author", "date", "sha"]);
  });

  it("la met en dernier sans cible", () => {
    expect(moveColumn(order, "refs", null)).toEqual(["graph", "message", "author", "date", "sha", "refs"]);
  });

  it("ne change rien quand la cible est la colonne elle-même", () => {
    expect(moveColumn(order, "date", "date")).toEqual(order);
  });
});

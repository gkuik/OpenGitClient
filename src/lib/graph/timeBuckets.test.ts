import { describe, expect, it } from "vitest";
import { bucketLabel, bucketOf, bucketStarts } from "./timeBuckets";

const NOW = 1_790_000_000;
const MIN = 60;
const HOUR = 3600;
const DAY = 86_400;

describe("bucketOf", () => {
  it("élargit les tranches avec l'âge", () => {
    expect(bucketOf(NOW - 30, NOW)).toEqual({ unit: "hour", n: 0 });
    expect(bucketOf(NOW - 3 * HOUR - 5 * MIN, NOW)).toEqual({ unit: "hour", n: 3 });
    expect(bucketOf(NOW - 2 * DAY, NOW)).toEqual({ unit: "day", n: 2 });
    expect(bucketOf(NOW - 16 * DAY, NOW)).toEqual({ unit: "week", n: 2 });
    expect(bucketOf(NOW - 100 * DAY, NOW)).toEqual({ unit: "month", n: 3 });
    expect(bucketOf(NOW - 800 * DAY, NOW)).toEqual({ unit: "year", n: 2 });
  });

  it("ne descend jamais sous un mois une fois passé cinq semaines", () => {
    expect(bucketOf(NOW - 36 * DAY, NOW)).toEqual({ unit: "month", n: 1 });
  });

  it("ne découpe jamais plus fin que l'heure", () => {
    // Toute la dernière heure est une seule tranche.
    expect(bucketOf(NOW - 2 * MIN, NOW)).toEqual({ unit: "hour", n: 0 });
    expect(bucketOf(NOW - 59 * MIN, NOW)).toEqual({ unit: "hour", n: 0 });
    const starts = bucketStarts([NOW - 5 * MIN, NOW - 20 * MIN, NOW - 50 * MIN], NOW);
    expect(starts.map((s) => s !== null)).toEqual([true, false, false]);
  });

  it("compte une date dans le futur dans la dernière heure", () => {
    expect(bucketOf(NOW + HOUR, NOW)).toEqual({ unit: "hour", n: 0 });
  });
});

describe("bucketStarts", () => {
  it("n'étiquette que le premier commit de chaque tranche", () => {
    const starts = bucketStarts(
      [NOW - 70 * MIN, NOW - 80 * MIN, NOW - 3 * HOUR, NOW - 3.5 * HOUR, NOW - 2 * DAY],
      NOW,
    );
    expect(starts).toEqual([
      { unit: "hour", n: 1 },
      null,
      { unit: "hour", n: 3 },
      null,
      { unit: "day", n: 2 },
    ]);
  });

  it("rouvre une tranche quand un commit plus ancien s'intercale", () => {
    const starts = bucketStarts([NOW - 70 * MIN, NOW - 3 * HOUR, NOW - 75 * MIN], NOW);
    expect(starts.map((s) => s !== null)).toEqual([true, true, true]);
  });
});

describe("bucketLabel", () => {
  it("s'appuie sur Intl pour les formes de la langue", () => {
    const en = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    expect(bucketLabel({ unit: "hour", n: 3 }, en)).toBe("3 hours ago");
    expect(bucketLabel({ unit: "day", n: 1 }, en)).toBe("yesterday");
    expect(bucketLabel({ unit: "hour", n: 0 }, en)).toBe("this hour");
  });
});

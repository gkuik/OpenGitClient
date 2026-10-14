import { describe, expect, it } from "vitest";
import {
  AUTO_FETCH_MINUTES_DEFAULT,
  AUTO_FETCH_MINUTES_MAX,
  clampAutoFetchMinutes,
  isAutoFetchDue,
  autoFetchPause,
  elapsed,
} from "./autoFetch";

const MIN = 60_000;

describe("clampAutoFetchMinutes", () => {
  it("garde les valeurs dans les bornes", () => {
    expect(clampAutoFetchMinutes(5)).toBe(5);
    expect(clampAutoFetchMinutes(0)).toBe(0);
    expect(clampAutoFetchMinutes(-3)).toBe(0);
    expect(clampAutoFetchMinutes(500)).toBe(AUTO_FETCH_MINUTES_MAX);
  });

  it("arrondit à la minute, et retombe sur le défaut pour une valeur illisible", () => {
    expect(clampAutoFetchMinutes(2.6)).toBe(3);
    expect(clampAutoFetchMinutes(Number.NaN)).toBe(AUTO_FETCH_MINUTES_DEFAULT);
  });
});

describe("isAutoFetchDue", () => {
  it("est dû tout de suite pour un dépôt jamais récupéré", () => {
    expect(isAutoFetchDue(0, Date.now(), 1)).toBe(true);
  });

  it("attend l'intervalle entier depuis le dernier passage", () => {
    const last = 1_000_000;
    expect(isAutoFetchDue(last, last + MIN - 1, 1)).toBe(false);
    expect(isAutoFetchDue(last, last + MIN, 1)).toBe(true);
    expect(isAutoFetchDue(last, last + 4 * MIN, 5)).toBe(false);
    expect(isAutoFetchDue(last, last + 5 * MIN, 5)).toBe(true);
  });

  it("n'est jamais dû à 0 minute : c'est la désactivation", () => {
    expect(isAutoFetchDue(0, Date.now(), 0)).toBe(false);
  });
});

describe("autoFetchPause", () => {
  it("suspend sur ce qui attend quelqu'un, pas sur ce qui passe tout seul", () => {
    expect(autoFetchPause("NoCredentials")).toBe("credentials");
    expect(autoFetchPause("RemoteAuth")).toBe("credentials");
    expect(autoFetchPause("NoRemote")).toBe("noRemote");
    expect(autoFetchPause("Network")).toBeNull();
    expect(autoFetchPause("NetworkBusy")).toBeNull();
  });
});

describe("elapsed", () => {
  it("dit « maintenant » sous la minute", () => {
    expect(elapsed(0)).toEqual({ value: 0, unit: "second" });
    expect(elapsed(59_999)).toEqual({ value: 0, unit: "second" });
  });

  it("passe à l'unité supérieure dès qu'elle est remplie, vers le passé", () => {
    expect(elapsed(MIN)).toEqual({ value: -1, unit: "minute" });
    expect(elapsed(59 * MIN)).toEqual({ value: -59, unit: "minute" });
    expect(elapsed(60 * MIN)).toEqual({ value: -1, unit: "hour" });
    expect(elapsed(49 * 60 * MIN)).toEqual({ value: -2, unit: "day" });
  });

  it("ne part pas dans le futur sur une horloge qui recule", () => {
    expect(elapsed(-5_000)).toEqual({ value: 0, unit: "second" });
  });
});

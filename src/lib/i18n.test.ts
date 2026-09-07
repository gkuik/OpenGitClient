import { describe, expect, it } from "vitest";
import { errorMessage, i18n, interpolate, pickLocale, t, tParts } from "./i18n.svelte";

describe("interpolate", () => {
  it("remplace les paramètres nommés", () => {
    expect(interpolate("Merge {source} into {target}", { source: "a", target: "b" })).toBe(
      "Merge a into b",
    );
  });

  it("laisse littéral un paramètre absent", () => {
    // Un texte incomplet vaut mieux qu'un « undefined » au milieu d'une phrase.
    expect(interpolate("{a} et {b}", { a: 1 })).toBe("1 et {b}");
  });
});

describe("pickLocale", () => {
  it("ignore la région", () => {
    expect(pickLocale(["en-GB"])).toBe("en");
  });

  it("retombe sur l'anglais quand rien ne correspond", () => {
    expect(pickLocale(["ja", "ko"])).toBe("en");
  });
});

describe("t", () => {
  it("choisit la forme du pluriel sur `n`", () => {
    expect(t("status.changes", { n: 1 })).toBe("1 change");
    expect(t("status.changes", { n: 2 })).toBe("2 changes");
    // Zéro n'est pas « one » en anglais.
    expect(t("status.changes", { n: 0 })).toBe("0 changes");
  });

  it("interpole les paramètres d'un message pluriel", () => {
    expect(t("op.fetch.updated", { where: "origin", n: 3 })).toBe("origin: 3 refs updated");
  });
});

describe("tParts", () => {
  it("sépare le texte des valeurs de paramètres, dans l'ordre du message", () => {
    expect(tParts("branches.merge.item", { source: "feat", target: "main" })).toEqual([
      { text: "Merge ", param: null },
      { text: "feat", param: "source" },
      { text: " into ", param: null },
      { text: "main", param: "target" },
    ]);
  });

  it("garde le littéral d'un paramètre non fourni", () => {
    // Sans valeur, il n'y a rien à mettre en forme : le texte passe entier.
    expect(tParts("branches.merge.item", { source: "feat" })).toEqual([
      { text: "Merge ", param: null },
      { text: "feat", param: "source" },
      { text: " into {target}", param: null },
    ]);
  });
});

describe("errorMessage", () => {
  it("traduit sur le `kind` et injecte `arg`", () => {
    expect(errorMessage({ kind: "ForgeToken", message: "…", arg: "github.com" })).toBe(
      "No access token saved for github.com",
    );
  });

  it("affiche tel quel un `kind` sans entrée au catalogue", () => {
    // `Git`, `Io`, `Network` : le message *est* le contenu.
    expect(errorMessage({ kind: "Git", message: "object not found" })).toBe("object not found");
  });

  it("ne retraduit pas une erreur construite côté frontend", () => {
    // Sinon le catalogue écraserait un message plus précis par le générique du
    // `kind` — c'est le cas des messages sur les clés SSH.
    expect(
      errorMessage({ kind: "NoCredentials", message: "No usable SSH key", localized: true }),
    ).toBe("No usable SSH key");
  });
});

describe("i18n", () => {
  it("rend le catalogue de la langue active", () => {
    i18n.set("en");
    expect(t("action.cancel")).toBe("Cancel");
  });
});

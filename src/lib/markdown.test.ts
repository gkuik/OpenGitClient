import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./markdown";

/** Recompose le texte brut d'une suite d'inlines, pour des assertions lisibles. */
function flat(parts: { value: string }[]): string {
  return parts.map((p) => p.value).join("");
}

describe("parseInline", () => {
  it("reconnaît code, gras, italique et liens", () => {
    expect(parseInline("voir `api.ts` et **le store**")).toEqual([
      { kind: "text", value: "voir " },
      { kind: "code", value: "api.ts" },
      { kind: "text", value: " et " },
      { kind: "strong", value: "le store" },
    ]);

    expect(parseInline("*important*")).toEqual([{ kind: "em", value: "important" }]);

    expect(parseInline("cf. [le ticket](https://ex.com/1)")).toEqual([
      { kind: "text", value: "cf. " },
      { kind: "link", value: "le ticket", href: "https://ex.com/1" },
    ]);

    expect(parseInline("https://ex.com/x")).toEqual([
      { kind: "link", value: "https://ex.com/x", href: "https://ex.com/x" },
    ]);
  });

  it("laisse le snake_case intact", () => {
    // `_` n'est pas de l'italique : sinon commit_graph_page serait massacré.
    const parts = parseInline("appelle commit_graph_page depuis stage_all");
    expect(parts).toEqual([
      { kind: "text", value: "appelle commit_graph_page depuis stage_all" },
    ]);
  });

  it("ne prend pas deux globs pour de l'italique", () => {
    const parts = parseInline("pousse refs/heads/* et refs/tags/*");
    expect(flat(parts)).toBe("pousse refs/heads/* et refs/tags/*");
    expect(parts.every((p) => p.kind === "text")).toBe(true);
  });

  it("protège le contenu d'un code inline", () => {
    expect(parseInline("`**pas gras**`")).toEqual([
      { kind: "code", value: "**pas gras**" },
    ]);
  });
});

describe("parseMarkdown", () => {
  it("conserve les retours à la ligne d'un paragraphe", () => {
    // Un message est coupé à 72 colonnes ; recoller les lignes collerait aussi
    // les trailers entre eux.
    const blocks = parseMarkdown("Première ligne\nSeconde ligne");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("paragraph");
    if (blocks[0].kind === "paragraph") {
      expect(blocks[0].lines.map(flat)).toEqual(["Première ligne", "Seconde ligne"]);
    }
  });

  it("sépare les paragraphes sur une ligne vide", () => {
    const blocks = parseMarkdown("un\n\ndeux");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "paragraph"]);
  });

  it("reconnaît titres, listes et citations", () => {
    const blocks = parseMarkdown(
      ["## Contexte", "- premier", "- second", "> une citation"].join("\n"),
    );

    expect(blocks.map((b) => b.kind)).toEqual(["heading", "list", "quote"]);
    if (blocks[0].kind === "heading") {
      expect(blocks[0].level).toBe(2);
      expect(flat(blocks[0].content)).toBe("Contexte");
    }
    if (blocks[1].kind === "list") {
      expect(blocks[1].ordered).toBe(false);
      expect(blocks[1].items.map(flat)).toEqual(["premier", "second"]);
    }
  });

  it("distingue une liste numérotée", () => {
    const blocks = parseMarkdown("1. un\n2. deux");
    expect(blocks[0].kind).toBe("list");
    if (blocks[0].kind === "list") {
      expect(blocks[0].ordered).toBe(true);
      expect(blocks[0].items).toHaveLength(2);
    }
  });

  it("garde un bloc de code verbatim", () => {
    const blocks = parseMarkdown("```rust\nlet x = **1**;\n```");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      kind: "code",
      lang: "rust",
      text: "let x = **1**;",
    });
  });

  it("ne boucle pas sur un bloc de code jamais refermé", () => {
    const blocks = parseMarkdown("```\ndu code\nsans clôture");
    expect(blocks).toEqual([{ kind: "code", lang: null, text: "du code\nsans clôture" }]);
  });

  it("traite le HTML comme du texte", () => {
    // Rien n'est interprété : la protection vient de l'échappement Svelte, et
    // le parseur ne doit surtout pas produire de nœud spécial ici.
    const blocks = parseMarkdown('<img src=x onerror="alert(1)">');
    expect(blocks).toHaveLength(1);
    if (blocks[0].kind === "paragraph") {
      expect(blocks[0].lines[0]).toEqual([
        { kind: "text", value: '<img src=x onerror="alert(1)">' },
      ]);
    }
  });

  it("renvoie une liste vide pour un texte vide", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n\n  \n")).toEqual([]);
  });
});

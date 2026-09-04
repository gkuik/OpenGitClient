import { describe, expect, it } from "vitest";
import { groupRefs } from "./refs";
import type { GraphRef } from "../types";

const local = (name: string): GraphRef => ({ name, kind: "localBranch" });
const head = (name: string): GraphRef => ({ name, kind: "head" });
const remote = (name: string): GraphRef => ({ name, kind: "remoteBranch" });

describe("groupRefs", () => {
  it("réunit une branche locale et son distant au même niveau", () => {
    const [b, ...rest] = groupRefs([local("main"), remote("origin/main")]);
    expect(rest).toHaveLength(0);
    expect(b.name).toBe("main");
    expect(b.local).toBe(true);
    expect(b.remotes).toEqual(["origin/main"]);
    expect(b.title).toBe("main · origin/main");
  });

  it("marque la branche courante", () => {
    const [b] = groupRefs([head("main"), remote("origin/main")]);
    expect(b.isHead).toBe(true);
  });

  it("laisse sa pastille au distant qui n'est pas sur le même commit", () => {
    // Le cas « local en retard » : les deux références sont sur deux rangées,
    // donc jamais dans le même appel.
    expect(groupRefs([local("main")])).toMatchObject([
      { name: "main", local: true, remotes: [] },
    ]);
    expect(groupRefs([remote("origin/main")])).toMatchObject([
      { name: "origin/main", local: false, remotes: ["origin/main"] },
    ]);
  });

  it("rapproche sur le suffixe le plus long", () => {
    const badges = groupRefs([local("x"), local("feat/x"), remote("origin/feat/x")]);
    expect(badges.find((b) => b.name === "feat/x")?.remotes).toEqual(["origin/feat/x"]);
    expect(badges.find((b) => b.name === "x")?.remotes).toEqual([]);
  });

  it("réunit plusieurs distants sur la même branche", () => {
    const [b] = groupRefs([
      local("main"),
      remote("origin/main"),
      remote("upstream/main"),
    ]);
    expect(b.remotes).toEqual(["origin/main", "upstream/main"]);
    expect(b.title).toBe("main · origin/main · upstream/main");
  });

  it("garde HEAD détaché comme pastille locale", () => {
    expect(groupRefs([head("HEAD")])).toMatchObject([
      { name: "HEAD", isHead: true, local: true },
    ]);
  });

  it("donne des clés distinctes à deux pastilles homonymes", () => {
    // Une branche locale peut légalement s'appeler « origin/main » : elle
    // n'absorbe pas la référence distante du même nom (qui n'en est pas un
    // suffixe), et les deux pastilles se retrouvent homonymes.
    const badges = groupRefs([local("origin/main"), remote("origin/main")]);
    expect(badges).toHaveLength(2);
    expect(badges.map((b) => b.key)).toEqual(["l:origin/main", "r:origin/main"]);
  });
});

describe("groupRefs — ordre", () => {
  it("met la branche courante en tête, les distantes en queue", () => {
    const names = groupRefs([
      remote("origin/solo"),
      local("aaa"),
      head("zzz"),
    ]).map((b) => b.name);
    expect(names).toEqual(["zzz", "aaa", "origin/solo"]);
  });
});

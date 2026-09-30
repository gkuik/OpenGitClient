import { describe, expect, it } from "vitest";
import { sortTags } from "./tags";
import type { TagEntry } from "./types";

const tag = (name: string): TagEntry => ({ name, oid: "0", message: null });

describe("sortTags", () => {
  it("met la dernière version en tête, les nombres comparés comme des nombres", () => {
    const names = sortTags([tag("v1.9.0"), tag("v1.10.0"), tag("v1.2.0")]).map((t) => t.name);
    expect(names).toEqual(["v1.10.0", "v1.9.0", "v1.2.0"]);
  });

  it("ne modifie pas la liste reçue", () => {
    const list = [tag("a"), tag("b")];
    sortTags(list);
    expect(list.map((t) => t.name)).toEqual(["a", "b"]);
  });
});

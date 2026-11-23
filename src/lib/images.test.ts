import { describe, expect, it } from "vitest";
import { formatBytes, formatBytesDelta, imageDataUrl, imageKind } from "./images";

describe("imageKind", () => {
  it("reconnaît les images que WebKit affiche, quelle que soit la casse", () => {
    for (const p of ["a.png", "b/c.JPG", "d.jpeg", "e.gif", "f.webp", "g.bmp", "favicon.ico"]) {
      expect(imageKind(p)).toBe("raster");
    }
  });

  it("met le SVG à part : c'est du texte", () => {
    expect(imageKind("icons/logo.svg")).toBe("svg");
    expect(imageKind("LOGO.SVG")).toBe("svg");
  });

  it("ignore le reste, et les noms sans extension", () => {
    expect(imageKind("README.md")).toBeNull();
    expect(imageKind("png")).toBeNull();
    expect(imageKind(".png")).toBeNull();
    expect(imageKind("img.png/readme")).toBeNull();
    expect(imageKind("archive.png.zip")).toBeNull();
  });
});

describe("imageDataUrl", () => {
  it("porte le type de l'extension", () => {
    expect(imageDataUrl("a.PNG", "AAAA")).toBe("data:image/png;base64,AAAA");
    expect(imageDataUrl("a.svg", "PHN2Zz4=")).toBe("data:image/svg+xml;base64,PHN2Zz4=");
  });
});

describe("formatBytes", () => {
  it("écrit les octets en toutes lettres, puis en unités décimales", () => {
    expect(formatBytes(1, "en")).toBe("1 byte");
    expect(formatBytes(999, "en")).toBe("999 bytes");
    expect(formatBytes(1000, "en")).toBe("1 kB");
    expect(formatBytes(1234, "en")).toBe("1.2 kB");
    expect(formatBytes(56_789, "en")).toBe("57 kB");
    expect(formatBytes(12_400_000, "en")).toBe("12 MB");
    expect(formatBytes(3_500_000, "en")).toBe("3.5 MB");
  });
});

describe("formatBytesDelta", () => {
  it("signe l'écart, et ne dit rien quand il est nul", () => {
    expect(formatBytesDelta(1000, 2234, "en")).toBe("+1.2 kB");
    expect(formatBytesDelta(1300, 1000, "en")).toBe("−300 bytes");
    expect(formatBytesDelta(5, 5, "en")).toBeNull();
  });
});

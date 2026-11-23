// Aperçu des images : ce qui se calcule seul, sans DOM ni backend.
//
// Le type MIME se déduit de l'extension, et c'est délibéré : la data URL a
// besoin d'un type, et le seul autre indice — les octets magiques — ne dit
// rien d'un SVG, qui est du texte.

/** Ce que le visualiseur sait faire d'un fichier image. */
export type ImageKind = "raster" | "svg";

/** Extension → type MIME : ce que WebKit sait afficher dans un `<img>`. */
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

function extension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  // Un point en tête (`.png`) est un fichier caché sans extension.
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Le fichier est-il une image, et laquelle ? Un SVG est à part : c'est du
 * texte, son code se lit aussi en diff — il garde la bascule Code | Preview.
 */
export function imageKind(path: string): ImageKind | null {
  const ext = extension(path);
  if (!(ext in MIME)) return null;
  return ext === "svg" ? "svg" : "raster";
}

/**
 * Data URL d'une image transmise en base64. Un SVG affiché dans un `<img>`
 * n'exécute aucun script : c'est ce qui rend son rendu sûr, le webview ayant
 * accès à `invoke`. Ne jamais l'insérer dans le DOM autrement.
 */
export function imageDataUrl(path: string, base64: string): string {
  return `data:${MIME[extension(path)] ?? "application/octet-stream"};base64,${base64}`;
}

/**
 * Poids lisible, en unités décimales comme le Finder (1 kB = 1000 octets) :
 * l'utilisateur compare avec ce que son système lui montre. `Intl` écrit
 * l'unité dans la langue de l'interface.
 */
export function formatBytes(bytes: number, locale: string): string {
  if (bytes < 1000) {
    return new Intl.NumberFormat(locale, { style: "unit", unit: "byte", unitDisplay: "long" }).format(bytes);
  }
  const units = ["kilobyte", "megabyte", "gigabyte"] as const;
  let value = bytes / 1000;
  let i = 0;
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000;
    i++;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: units[i],
    unitDisplay: "short",
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

/**
 * Écart de poids entre l'avant et l'après, signé (`+1.2 kB`, `−300 bytes`) ;
 * `null` quand rien n'a changé — un « +0 » n'apprendrait rien.
 */
export function formatBytesDelta(before: number, after: number, locale: string): string | null {
  const delta = after - before;
  if (delta === 0) return null;
  // Le vrai signe moins (U+2212), de la largeur du plus.
  return (delta > 0 ? "+" : "−") + formatBytes(Math.abs(delta), locale);
}

// Ordre de la section TAGS.
//
// Le backend les renvoie triés par nom, octet par octet : `v1.10.0` y passe
// avant `v1.9.0`, et la dernière version se retrouve n'importe où dans la
// liste. Ici, les nombres sont comparés comme des nombres, et la liste va du
// plus récent au plus ancien — la version qu'on cherche est presque toujours
// la dernière posée.

import type { TagEntry } from "./types";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Trie les tags par nom décroissant, les segments numériques comparés comme
 * des nombres (`v1.10.0` avant `v1.9.0`). Ne modifie pas la liste reçue.
 *
 * Aucune lecture de semver : un nom de tag est libre, et une règle qui ne vaut
 * que pour une partie d'entre eux rangerait les autres au hasard. La
 * comparaison numérique suffit à ce qui compte — que la dernière version soit
 * en tête.
 */
export function sortTags(tags: TagEntry[]): TagEntry[] {
  return [...tags].sort((a, b) => collator.compare(b.name, a.name));
}

// Git Flow : ce qui se calcule sans rien demander à personne — la bande de
// chaque commit dans le graph, le genre d'une branche d'après son nom, d'où
// elle part et où elle revient. Fonctions pures, testées à part ; le store
// orchestre, le graph dessine.
//
// La configuration est propre à l'application (`projects.json`) : rien n'est
// lu ni écrit dans les clés `gitflow.*` de `.git/config`, et les préfixes sont
// ceux de git-flow, fixes.

import type { GraphBands } from "./graph/layout";
import type { BranchEntry, GitFlowConfig, GraphCommit, RemoteBranchEntry } from "./types";

/** Les quatre sortes de branches de travail. */
export type FlowKind = "feature" | "bugfix" | "release" | "hotfix";

export const FLOW_KINDS: FlowKind[] = ["feature", "bugfix", "release", "hotfix"];

export const FLOW_PREFIX: Record<FlowKind, string> = {
  feature: "feature/",
  bugfix: "bugfix/",
  release: "release/",
  hotfix: "hotfix/",
};

/** Sorte d'une branche d'après son préfixe, `null` si elle n'en a pas. */
export function flowKindOf(branch: string | null | undefined): FlowKind | null {
  if (!branch) return null;
  return FLOW_KINDS.find((k) => branch.startsWith(FLOW_PREFIX[k]) && branch.length > FLOW_PREFIX[k].length) ?? null;
}

/** Ce qui suit le préfixe : le nom de la feature, la version de la release. */
export function flowSuffix(branch: string): string {
  const kind = flowKindOf(branch);
  return kind ? branch.slice(FLOW_PREFIX[kind].length) : branch;
}

/**
 * Nom complet d'une branche de travail à partir de ce qu'on a tapé : le
 * préfixe, puis le nom, blancs remplacés par des tirets — un espace n'est pas
 * permis dans une référence, et c'est presque toujours un tiret qu'on voulait.
 */
export function flowBranchName(kind: FlowKind, typed: string): string {
  return FLOW_PREFIX[kind] + typed.trim().replace(/\s+/g, "-");
}

/** D'où part une branche de travail : `main` pour un hotfix, `develop` sinon. */
export function flowBase(kind: FlowKind, config: GitFlowConfig): string {
  return kind === "hotfix" ? config.main : config.develop;
}

/**
 * Où elle revient, dans l'ordre : une release ou un hotfix vont en production
 * puis reviennent dans `develop` ; une feature ou un bugfix ne vont que dans
 * `develop`.
 */
export function flowTargets(kind: FlowKind, config: GitFlowConfig): string[] {
  return kind === "release" || kind === "hotfix" ? [config.main, config.develop] : [config.develop];
}

/** Une release ou un hotfix terminés laissent un tag sur `main`. */
export function flowTagged(kind: FlowKind): boolean {
  return kind === "release" || kind === "hotfix";
}

/**
 * Tag proposé en fin de release ou de hotfix : la version, préfixée d'un `v`
 * quand elle commence par un chiffre (`release/1.2.0` → `v1.2.0`) — la
 * convention la plus répandue. Le champ reste modifiable.
 */
export function defaultTag(branch: string): string {
  const version = flowSuffix(branch);
  return /^\d/.test(version) ? `v${version}` : version;
}

/**
 * Réglages proposés à la première activation, déduits des branches locales :
 * `main` ou `master` en production, `develop` ou `dev` en intégration. L'ordre
 * des colonnes est celui de la demande — production, préproduction,
 * intégration —, puis les releases et les hotfixes ; les features viennent
 * après, sans avoir à figurer dans la liste.
 */
export function defaultFlowConfig(locals: string[]): GitFlowConfig {
  const pick = (candidates: string[]) => candidates.find((c) => locals.includes(c)) ?? candidates[0];
  const main = pick(["main", "master"]);
  const develop = pick(["develop", "dev"]);
  return {
    enabled: false,
    main,
    develop,
    order: [main, "stage", develop, "release/*", "hotfix/*"],
  };
}

/** Une entrée de l'ordre se termine-t-elle par `*` — un groupe plutôt qu'un nom ? */
export function isPattern(entry: string): boolean {
  return entry.endsWith("*");
}

/** Le nom de branche répond-il à l'entrée (nom exact, ou préfixe avant `*`) ? */
export function matchesEntry(entry: string, name: string): boolean {
  return isPattern(entry) ? name.startsWith(entry.slice(0, -1)) : name === entry;
}

/** Pointe d'une branche, nom court (sans le distant pour une branche distante). */
export interface FlowTip {
  name: string;
  oid: string;
}

/**
 * Pointes à placer : les branches locales, puis les distantes sous leur nom
 * court. Les deux comptent — `origin/develop` en avance sur `develop` reste
 * dans la colonne de `develop`, et une branche qu'on n'a pas en local garde
 * quand même sa place.
 */
export function flowTips(locals: BranchEntry[], remotes: RemoteBranchEntry[]): FlowTip[] {
  return [
    ...locals.filter((b) => b.oid).map((b) => ({ name: b.name, oid: b.oid })),
    ...remotes.map((r) => ({ name: r.name.slice(r.remote.length + 1), oid: r.oid })),
  ];
}

/**
 * Pointe d'une branche pérenne : la locale si elle existe, sinon la distante
 * de même nom (`origin` d'abord). `null` si elle n'existe nulle part.
 */
export function resolveTip(
  name: string,
  locals: BranchEntry[],
  remotes: RemoteBranchEntry[],
): { oid: string; from: string } | null {
  const local = locals.find((b) => b.name === name && b.oid);
  if (local) return { oid: local.oid, from: local.name };
  const matching = remotes.filter((r) => r.name.slice(r.remote.length + 1) === name);
  const remote = matching.find((r) => r.remote === "origin") ?? matching[0];
  return remote ? { oid: remote.oid, from: remote.name } : null;
}

/**
 * Bande de chaque commit chargé : l'index de l'entrée de `order` à laquelle il
 * appartient. Un commit appartient à une branche s'il est sur la chaîne de
 * **premiers parents** depuis sa pointe — la ligne que la branche a suivie,
 * pas tout ce qu'elle a fusionné.
 *
 * Un commit sur plusieurs chaînes va à la première qui le réclame, et l'ordre
 * des réclamations n'est pas tout à fait celui des colonnes : **les noms
 * exacts passent avant les groupes**. Une release part de `develop` ; si
 * `release/*` réclamait avant `develop`, toute l'histoire de `develop` sous le
 * point de départ serait dessinée dans la colonne de la release. Entre noms
 * exacts, l'ordre des colonnes décide : l'histoire commune à `main` et
 * `develop` reste dans la colonne de `main`.
 *
 * Seuls les commits chargés comptent : la chaîne s'arrête au bord de la page.
 * Un commit qu'aucune entrée ne réclame n'a pas de bande — il ira dans la
 * bande libre, à droite.
 */
export function flowBands(commits: GraphCommit[], tips: FlowTip[], order: string[]): GraphBands {
  const byOid = new Map(commits.map((c) => [c.oid, c]));
  const bandOf = new Map<string, number>();

  const claim = (band: number, tip: string) => {
    let oid: string | undefined = tip;
    while (oid !== undefined && !bandOf.has(oid)) {
      const commit = byOid.get(oid);
      if (!commit) break;
      bandOf.set(oid, band);
      oid = commit.parents[0];
    }
  };

  const entries = order.map((entry, band) => ({ entry, band }));
  const passes = [
    entries.filter((e) => !isPattern(e.entry)),
    entries.filter((e) => isPattern(e.entry)),
  ];
  for (const pass of passes) {
    for (const { entry, band } of pass) {
      for (const tip of tips) {
        if (matchesEntry(entry, tip.name)) claim(band, tip.oid);
      }
    }
  }

  return { bandOf, count: order.length };
}

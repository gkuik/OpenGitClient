// Auto-fetch, façon GitKraken : le dépôt affiché récupère tous ses distants en
// tâche de fond, à un intervalle réglé en minutes (1 par défaut, 0 = jamais).
//
// Ce module ne garde que ce qui se calcule sans demander rien à personne — les
// bornes, l'échéance, les erreurs qui suspendent —, testé à part comme
// `layout.ts` ou `tags.ts`. La préférence vit dans `autoFetch.svelte.ts`, la
// minuterie dans `TabsStore`.

/** Défaut et bornes — `AUTO_FETCH_MINUTES_*` côté Rust. */
export const AUTO_FETCH_MINUTES_DEFAULT = 1;
export const AUTO_FETCH_MINUTES_MAX = 60;

/** Ramène une valeur dans les bornes, en minutes entières. */
export function clampAutoFetchMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return AUTO_FETCH_MINUTES_DEFAULT;
  return Math.min(Math.max(Math.round(minutes), 0), AUTO_FETCH_MINUTES_MAX);
}

/**
 * Le prochain auto-fetch est-il dû ? `lastFetchAt` est le dernier passage sur
 * le réseau, auto *ou* manuel — un Fetch cliqué il y a dix secondes n'a pas à
 * être refait —, `0` s'il n'y en a jamais eu : un dépôt qu'on vient d'ouvrir
 * est donc récupéré tout de suite, comme dans GitKraken.
 */
export function isAutoFetchDue(lastFetchAt: number, now: number, minutes: number): boolean {
  return minutes > 0 && now - lastFetchAt >= minutes * 60_000;
}

/**
 * Pourquoi l'auto-fetch d'un dépôt est suspendu : un identifiant manquant ou
 * refusé, ou aucun distant. Les deux se distinguent parce que seul le premier
 * se dit à l'utilisateur — un dépôt sans distant n'a rien à récupérer, et le
 * signaler chaque fois serait du bruit.
 */
export type AutoFetchPause = "credentials" | "noRemote";

/**
 * Les erreurs qui **suspendent** l'auto-fetch du dépôt plutôt que de le laisser
 * réessayer à la prochaine échéance, et pour quelle raison. Elles ne se
 * résolvent pas toutes seules : un identifiant manquant ou refusé attend une
 * saisie — réessayer chaque minute ne ferait que marteler le serveur d'échecs
 * d'authentification —, un dépôt sans distant attend qu'on en déclare un. Le
 * reste (réseau coupé, serveur injoignable) passe souvent tout seul : `null`,
 * on réessaie, en silence.
 */
export function autoFetchPause(kind: string): AutoFetchPause | null {
  if (kind === "NoCredentials" || kind === "RemoteAuth") return "credentials";
  if (kind === "NoRemote") return "noRemote";
  return null;
}

/**
 * Délai écoulé, dans l'unité la plus grosse qu'il remplit — de quoi écrire
 * « il y a 3 minutes » avec `Intl.RelativeTimeFormat`, qui connaît la langue.
 * Sous la minute, c'est « maintenant » (`0` seconde, `numeric: "auto"`) : à
 * l'échelle de l'auto-fetch, les secondes ne disent rien d'utile, et un
 * compteur qui défile attirerait l'œil pour rien.
 */
export function elapsed(ms: number): { value: number; unit: "second" | "minute" | "hour" | "day" } {
  const minutes = Math.floor(Math.max(ms, 0) / 60_000);
  if (minutes < 1) return { value: 0, unit: "second" };
  if (minutes < 60) return { value: -minutes, unit: "minute" };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { value: -hours, unit: "hour" };
  return { value: -Math.floor(hours / 24), unit: "day" };
}

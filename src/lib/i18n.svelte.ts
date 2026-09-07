/*
  Internationalisation de l'interface.

  Un module maison plutôt qu'une bibliothèque, pour la même raison que
  `markdown.ts` : le projet vise un binaire léger et n'embarque aucune
  dépendance runtime. Ce qu'une bibliothèque apporterait de vraiment difficile —
  les catégories de pluriel et le format des dates — est déjà dans le webview,
  sous `Intl`.

  **Le catalogue anglais est la référence** : `MessageKey` en est déduit, donc
  ajouter une langue se réduit à un fichier de `locales/` typé `Catalog`, où
  toute clé oubliée est une erreur de compilation, plus une entrée dans
  `CATALOGS` et dans `LOCALES`. Rien d'autre à toucher : aucun composant ne sait
  quelle langue est active.

  La langue n'est **pas** persistée côté Rust, contrairement au thème ou à la
  taille du texte : tant qu'il n'y a qu'un catalogue, il n'y aurait rien à
  choisir et le réglage serait un bouton sans effet. `init()` lit la préférence
  du système, ce qui suffira à faire apparaître une seconde langue le jour où
  elle existe ; le réglage explicite viendra avec elle.
*/
import { en } from "./locales/en";
import type { AppError } from "./types";

/** Langues disponibles. Ajouter un catalogue, c'est ajouter une entrée ici. */
export const LOCALES = ["en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Langue de repli : celle dont le catalogue est complet par construction. */
const FALLBACK: Locale = "en";

/**
 * Catégories de pluriel du CLDR. `Intl.PluralRules` en choisit une ; une langue
 * n'en utilise qu'une partie (deux en anglais, quatre en polonais), d'où le
 * `Partial` avec `other` seul obligatoire — c'est la catégorie que toute langue
 * possède.
 */
type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";
type Plural = { other: string } & Partial<Record<PluralCategory, string>>;

/** Une entrée du catalogue : un texte, ou ses formes de pluriel. */
export type Message = string | Plural;

export type MessageKey = keyof typeof en;
export type Catalog = Record<MessageKey, Message>;

const CATALOGS: Record<Locale, Catalog> = { en };

/** Valeurs injectées dans les `{...}` du message ; `n` porte aussi le pluriel. */
export type Params = Record<string, string | number>;

class I18n {
  /** Langue appliquée. La lire depuis `t()` est ce qui rend tout réactif. */
  locale = $state<Locale>(FALLBACK);

  /** Construit une seule fois par langue, et non à chaque pluriel rendu. */
  plurals = $derived(new Intl.PluralRules(this.locale));

  /**
   * Choisit la langue d'après les préférences du système. Appelée avant le
   * montage, comme `theme.init()` : sans catalogue à charger, rien n'arrive en
   * retard, donc rien ne clignote.
   */
  init() {
    if (typeof navigator === "undefined") return;
    this.set(pickLocale(navigator.languages ?? [navigator.language]));
  }

  /** Change de langue. Tout ce qui affiche du texte se remet à jour tout seul. */
  set(locale: Locale) {
    this.locale = locale;
    // `<html lang>` est la seule chose que le CSS et les runes n'atteignent pas :
    // c'est lui que lisent la synthèse vocale et la césure du navigateur.
    if (typeof document !== "undefined") document.documentElement.lang = locale;
  }
}

export const i18n = new I18n();

/**
 * Première langue disponible parmi les étiquettes BCP 47 données, en ignorant
 * la région : `fr-CA` retient `fr`. Fonction pure, donc testable sans webview.
 */
export function pickLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const base = tag.toLowerCase().split("-")[0];
    const match = LOCALES.find((locale) => locale === base);
    if (match) return match;
  }
  return FALLBACK;
}

/** Remplace les `{nom}` par leur valeur ; un paramètre absent reste littéral. */
export function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** Texte brut d'une clé, forme de pluriel choisie, avant interpolation. */
function raw(key: MessageKey, params?: Params): string {
  const message = CATALOGS[i18n.locale][key] ?? CATALOGS[FALLBACK][key];
  if (message === undefined) return key;
  if (typeof message === "string") return message;
  const category = i18n.plurals.select(Number(params?.n ?? 0)) as PluralCategory;
  return message[category] ?? message.other;
}

/** Le texte d'une clé, dans la langue active. */
export function t(key: MessageKey, params?: Params): string {
  return interpolate(raw(key, params), params);
}

/** Un morceau de phrase : du texte, ou la valeur d'un paramètre nommé. */
export type Part = { text: string; param: string | null };

/**
 * Découpe le message rendu en gardant trace de ce qui vient des paramètres.
 *
 * C'est ce qui permet de mettre en forme un mot **au milieu** d'une phrase
 * (`<strong>`, `<code>`) sans découper cette phrase en morceaux à recoller :
 * l'ordre des mots change d'une langue à l'autre, pas l'existence du paramètre.
 * Voir `RichText.svelte`, seul appelant prévu.
 */
export function tParts(key: MessageKey, params?: Params): Part[] {
  const text = raw(key, params);
  const parts: Part[] = [];
  let last = 0;
  for (const match of text.matchAll(/\{(\w+)\}/g)) {
    const name = match[1];
    if (!params || !(name in params)) continue;
    if (match.index > last) parts.push({ text: text.slice(last, match.index), param: null });
    parts.push({ text: String(params[name]), param: name });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), param: null });
  return parts;
}

/**
 * Message d'une erreur applicative, traduit quand on sait le faire.
 *
 * Le backend envoie un `kind` stable **et** un message anglais ; c'est le
 * `kind` qui sert de clé, `arg` fournissant le paramètre que la variante porte.
 * Deux replis, dans cet ordre : un `kind` sans entrée au catalogue (`Git`,
 * `Io`, `Network`…) affiche le message tel quel — il *est* le contenu, pas un
 * gabarit — et une erreur déjà construite ici (`localized`) n'est pas retraduite,
 * sans quoi le catalogue écraserait un message plus précis.
 */
export function errorMessage(error: AppError): string {
  if (error.localized) return error.message;
  const key = `error.${error.kind}` as MessageKey;
  if (!(key in CATALOGS[FALLBACK])) return error.message;
  return t(key, error.arg ? { arg: error.arg } : undefined);
}

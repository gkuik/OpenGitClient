// Taille du texte de l'interface : le choix de l'utilisateur, et sa mise à
// l'échelle.
//
// Le module ne fait qu'écrire `font-size` sur `<html>` — tout le reste de
// l'interface étant exprimé en rem, c'est la seule valeur à changer pour mettre
// l'application entière à l'échelle, espacements compris. Les composants n'ont
// donc rien à lire ici, sauf le graph, dont la hauteur de rangée aligne un
// canvas sur du DOM et ne peut pas s'exprimer en CSS.

import { api } from "./api";

/**
 * Ratio du corps de texte dans l'échelle rem : dans cette base de code, le texte
 * courant (nom de fichier, nom de branche, résumé de commit) s'écrit `0.82rem`.
 * La racine n'a jamais été la taille du texte, seulement sa référence — on la
 * calcule donc pour que ce ratio tombe pile sur la taille choisie, plutôt que de
 * réécrire les quatre-vingt-dix `font-size` des composants.
 */
const BODY_RATIO = 0.82;

/** Taille du texte système de macOS, et défaut de l'application. */
export const FONT_SIZE_DEFAULT = 13;

/**
 * Tailles proposées dans les paramètres, en points. Les bornes doivent rester
 * celles de `FONT_SIZE_MIN` / `FONT_SIZE_MAX` (`src-tauri/src/dto.rs`), qui
 * ramènent de toute façon dans l'intervalle ce qui en sort.
 */
export const FONT_SIZES = [11, 12, 13, 14, 16, 18];

/**
 * La taille est en **points** : l'unité des recommandations d'Apple, et celle du
 * pixel CSS à l'échelle 1× de macOS — 13 pt y sont donc bien 13 px de texte.
 */
class FontStore {
  /** Choix persisté, tel qu'il apparaît dans les paramètres. */
  size = $state(FONT_SIZE_DEFAULT);

  /** Taille de la racine, celle que porte réellement `<html>`. */
  get rootPx(): number {
    return this.size / BODY_RATIO;
  }

  /**
   * Charge la préférence.
   *
   * Rien n'est appliqué avant sa lecture : le défaut vit déjà dans `app.css`,
   * et l'écraser par la même valeur ne ferait qu'ajouter un rendu. Comme pour le
   * thème, rien n'est mis en cache dans le webview — la persistance reste côté
   * Rust —, donc une taille autre que le défaut se met en place un aller-retour
   * après le premier rendu.
   */
  init() {
    api
      .getFontSize()
      .then((size) => {
        this.size = size;
        this.apply();
      })
      .catch(() => {
        /* préférence illisible : on reste sur le défaut de la feuille de style */
      });
  }

  /**
   * Change la taille. L'interface suit tout de suite, la persistance ensuite :
   * un échec d'écriture ne coûte que la survie du choix au prochain démarrage.
   */
  async set(size: number) {
    this.size = size;
    this.apply();
    try {
      await api.setFontSize(size);
    } catch {
      /* préférence non enregistrée : la taille reste appliquée pour cette session */
    }
  }

  private apply() {
    document.documentElement.style.fontSize = `${this.rootPx}px`;
  }
}

export const font = new FontStore();

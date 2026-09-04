// Thème de l'interface : le choix de l'utilisateur, et sa résolution.
//
// Les couleurs elles-mêmes vivent dans `app.css` : ce module ne fait que poser
// `data-theme` sur `<html>`, l'attribut sur lequel la feuille de style bascule.
// Les composants n'ont donc rien à lire ici — sauf le graph, dont les lanes sont
// peintes sur un canvas, hors de portée du CSS.

import { api } from "./api";
import type { ThemeMode } from "./types";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Deux valeurs à ne pas confondre : `mode` est ce qui est *choisi* et persisté
 * (clair, sombre, ou « système »), `dark` ce qui est *appliqué*. « Système »
 * n'a pas de palette à lui — il délègue à `prefers-color-scheme`, et suit donc
 * l'utilisateur qui change d'apparence pendant que l'application tourne.
 */
class ThemeStore {
  /** Choix persisté, tel qu'il apparaît dans les paramètres. */
  mode = $state<ThemeMode>("system");
  /** Apparence du système, seule lecture réactive de `matchMedia`. */
  private systemDark = $state(true);

  /** Le thème réellement appliqué. */
  get dark(): boolean {
    return this.mode === "system" ? this.systemDark : this.mode === "dark";
  }

  /**
   * Pose le thème avant le premier rendu.
   *
   * L'apparence du système est lue en **synchrone**, la préférence arrive un
   * aller-retour plus tard : comme « système » est le défaut, l'écran est déjà
   * dans la bonne palette pour la plupart des lancements, et le seul cas qui
   * clignote est celui d'un thème forcé à l'inverse du système. Rien n'est
   * stocké dans le webview pour l'éviter — la persistance reste côté Rust,
   * comme les récents, les profils et le mode du bouton Pull.
   */
  init() {
    const query = window.matchMedia(DARK_QUERY);
    this.systemDark = query.matches;
    query.addEventListener("change", (e) => {
      this.systemDark = e.matches;
      this.apply();
    });
    this.apply();

    api
      .getTheme()
      .then((mode) => {
        this.mode = mode;
        this.apply();
      })
      .catch(() => {
        /* préférence illisible : on reste sur le système */
      });
  }

  /**
   * Change le thème. L'interface suit tout de suite, la persistance ensuite :
   * un échec d'écriture ne coûte que la survie du choix au prochain démarrage.
   */
  async set(mode: ThemeMode) {
    this.mode = mode;
    this.apply();
    try {
      await api.setTheme(mode);
    } catch {
      /* préférence non enregistrée : le thème reste appliqué pour cette session */
    }
  }

  /**
   * `data-theme` porte le thème **résolu**, jamais « système » : le CSS n'a ainsi
   * qu'un cas à traiter, et la fenêtre native reçoit de son côté le choix brut
   * (voir `commands::set_theme`), le seul à savoir déléguer au système.
   */
  private apply() {
    document.documentElement.dataset.theme = this.dark ? "dark" : "light";
  }
}

export const theme = new ThemeStore();

// Tracé des lignes du graph quand elles changent de colonne : angle droit
// arrondi (par défaut), angle droit vif, courbe en S ou diagonale droite — et
// l'arrondi des deux tracés qui en ont un.
//
// Préférence globale, persistée dans `prefs.json` comme le thème. Le canvas la
// lit dans `draw()`, ce qui suffit à le redessiner quand elle change.

import { api } from "./api";
import type { GraphLineStyle } from "./types";

export const GRAPH_LINE_STYLES: readonly GraphLineStyle[] = ["rounded", "sharp", "curve", "diagonal"];

/** Arrondi par défaut, en pourcentage — `GRAPH_ROUNDNESS_DEFAULT` côté Rust. */
export const GRAPH_ROUNDNESS_DEFAULT = 60;

/** Les tracés que l'arrondi concerne : les deux autres n'en ont pas. */
export function hasRoundness(style: GraphLineStyle): boolean {
  return style === "rounded" || style === "curve";
}

/** Un curseur émet une valeur par image : on n'écrit que la dernière. */
const SAVE_DELAY_MS = 300;

class GraphLinesStore {
  style = $state<GraphLineStyle>("rounded");
  /**
   * Arrondi, de 0 à 100 % du maximum que la géométrie permet : l'arc d'un coude
   * arrondi jusqu'au quart de cercle, la tension d'une courbe jusqu'au S le plus
   * marqué.
   */
  roundness = $state(GRAPH_ROUNDNESS_DEFAULT);

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Charge la préférence ; jusque-là, et sans backend, le défaut s'applique. */
  init() {
    api
      .getGraphLines()
      .then((style) => {
        this.style = style;
      })
      .catch(() => {
        /* préférence illisible : tracé par défaut */
      });
    api
      .getGraphRoundness()
      .then((roundness) => {
        this.roundness = roundness;
      })
      .catch(() => {
        /* préférence illisible : arrondi par défaut */
      });
  }

  /**
   * Le graph suit tout de suite ; un échec d'écriture ne coûte que la survie
   * du choix au prochain démarrage.
   */
  set(style: GraphLineStyle) {
    this.style = style;
    api.setGraphLines(style).catch(() => {
      /* préférence non enregistrée : le tracé tient pour la session */
    });
  }

  /** Le graph suit à chaque mouvement du curseur ; l'écriture, elle, attend. */
  setRoundness(roundness: number) {
    this.roundness = Math.min(Math.max(Math.round(roundness), 0), 100);
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      api.setGraphRoundness(this.roundness).catch(() => {
        /* préférence non enregistrée : l'arrondi tient pour la session */
      });
    }, SAVE_DELAY_MS);
  }
}

export const graphLines = new GraphLinesStore();

// Tracé des lignes du graph quand elles changent de colonne : angle droit
// arrondi (par défaut), angle droit vif, courbe en S ou diagonale droite.
//
// Préférence globale, persistée dans `prefs.json` comme le thème. Le canvas la
// lit dans `draw()`, ce qui suffit à le redessiner quand elle change.

import { api } from "./api";
import type { GraphLineStyle } from "./types";

export const GRAPH_LINE_STYLES: readonly GraphLineStyle[] = ["rounded", "sharp", "curve", "diagonal"];

class GraphLinesStore {
  style = $state<GraphLineStyle>("rounded");

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
}

export const graphLines = new GraphLinesStore();

// Intervalle de l'auto-fetch, en minutes — préférence globale, persistée dans
// `prefs.json` comme le tracé du graph. Rien ici ne lance de fetch : la
// minuterie est dans `TabsStore`, qui lit `minutes` à chaque tour, ce qui
// suffit à ce qu'un nouveau réglage s'applique sans rien redémarrer.

import { api } from "./api";
import { AUTO_FETCH_MINUTES_DEFAULT, clampAutoFetchMinutes } from "./autoFetch";

/** Un curseur émet une valeur par image : on n'écrit que la dernière. */
const SAVE_DELAY_MS = 300;

class AutoFetchStore {
  /** 0 = désactivé. */
  minutes = $state(AUTO_FETCH_MINUTES_DEFAULT);

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Charge la préférence ; jusque-là, et sans backend, le défaut s'applique. */
  init() {
    api
      .getAutoFetchMinutes()
      .then((minutes) => {
        this.minutes = clampAutoFetchMinutes(minutes);
      })
      .catch(() => {
        /* préférence illisible : intervalle par défaut */
      });
  }

  /** Effet immédiat ; l'écriture, elle, attend que le curseur se pose. */
  set(minutes: number) {
    this.minutes = clampAutoFetchMinutes(minutes);
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      api.setAutoFetchMinutes(this.minutes).catch(() => {
        /* préférence non enregistrée : l'intervalle tient pour la session */
      });
    }, SAVE_DELAY_MS);
  }

  reset() {
    this.set(AUTO_FETCH_MINUTES_DEFAULT);
  }
}

export const autoFetch = new AutoFetchStore();

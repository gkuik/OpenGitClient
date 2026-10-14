// Éditeur et terminal ouverts par la barre du dépôt — préférence globale,
// persistée dans `prefs.json`. Le backend détecte ce qui est installé et
// décide de l'application effective ; ce module ne fait que garder sa réponse,
// que la barre (boutons grisés, infobulles) et les Réglages lisent.

import { api } from "./api";
import type { AppError, ExternalAppKind, ExternalApps } from "./types";

class ExternalAppsStore {
  apps = $state<ExternalApps>({ editors: [], terminals: [], editor: null, terminal: null });

  /**
   * Relit ce qui est installé. Au démarrage, et à l'ouverture des Réglages :
   * une application installée entre-temps doit y apparaître.
   */
  load() {
    api
      .getExternalApps()
      .then((apps) => {
        this.apps = apps;
      })
      .catch(() => {
        /* dans un navigateur sans backend : rien à ouvrir */
      });
  }

  /** Choisit l'application ; `null` revient au défaut. */
  async set(kind: ExternalAppKind, name: string | null): Promise<AppError | null> {
    try {
      this.apps = await api.setExternalApp(kind, name);
      return null;
    } catch (e) {
      return e as AppError;
    }
  }
}

export const externalApps = new ExternalAppsStore();

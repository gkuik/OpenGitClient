// Disposition du tableau du graph : ordre, colonnes masquées, largeurs.
//
// Préférence globale, persistée dans `prefs.json` comme les largeurs des
// colonnes latérales (`layout.svelte.ts`), et selon le même contrat :
// l'interface suit tout de suite, l'écriture est différée — un redimensionnement
// émet un événement par image, on n'en persiste que le résultat.
//
// Tout ce qui se calcule vit dans `graph/columns.ts`, pur et testé ; ce module
// ne fait que garder l'état et le faire suivre au backend.

import { api } from "./api";
import { font } from "./font.svelte";
import {
  COL_W_MAX,
  COL_W_MIN,
  DEFAULT_COLUMNS,
  MESSAGE,
  moveColumn,
  normalizeColumns,
  type ColumnId,
  type GraphColumns,
} from "./graph/columns";

const SAVE_DELAY_MS = 300;

class GraphColumnsStore {
  columns = $state<GraphColumns>(structuredClone(DEFAULT_COLUMNS));

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Charge la préférence. Jusque-là, et dans un navigateur sans backend, le
   * tableau s'affiche avec la disposition par défaut.
   */
  init() {
    api
      .getGraphColumns()
      .then((raw) => {
        this.columns = normalizeColumns(raw);
      })
      .catch(() => {
        /* préférence illisible : disposition par défaut */
      });
  }

  /**
   * Pose une largeur mesurée en pixels, ou l'efface (`null`) pour revenir au
   * défaut — pour le graph, à la largeur ajustée au nombre de branches.
   */
  setWidthPx(id: ColumnId, px: number | null) {
    if (id === MESSAGE) return;
    const widths = { ...this.columns.widths };
    if (px === null) delete widths[id];
    else widths[id] = Math.min(Math.max(px / font.rootPx, COL_W_MIN), COL_W_MAX);
    this.update({ ...this.columns, widths });
  }

  /** Affiche ou masque une colonne. Le message reste toujours affiché. */
  toggle(id: ColumnId) {
    if (id === MESSAGE) return;
    const { hidden } = this.columns;
    this.update({
      ...this.columns,
      hidden: hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id],
    });
  }

  /** Déplace une colonne juste avant `beforeId` (`null` : en dernier). */
  move(id: ColumnId, beforeId: ColumnId | null) {
    this.update({ ...this.columns, order: moveColumn(this.columns.order, id, beforeId) });
  }

  /** Ordre, visibilité et largeurs d'origine. */
  reset() {
    this.update(structuredClone(DEFAULT_COLUMNS));
  }

  private update(next: GraphColumns) {
    this.columns = next;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      api.setGraphColumns(this.columns).catch(() => {
        /* préférence non enregistrée : la disposition tient pour la session */
      });
    }, SAVE_DELAY_MS);
  }
}

export const graphColumns = new GraphColumnsStore();

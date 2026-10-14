<script lang="ts">
  /*
    Confirmation de « Discard all » : irréversible, et sans dialogue natif
    (aucune capacité de confirmation déclarée) — un panneau qui dit ce qui va
    disparaître avant de le faire. Deux endroits l'ouvrent, l'en-tête de la
    colonne de droite et le bouton de la barre du dépôt : le panneau est le
    même, seule sa place change, d'où `style`, que l'appelant fournit.

    Les non suivis seront *supprimés* du disque, les suivis seulement ramenés à
    HEAD : les deux nombres sont annoncés séparément parce qu'ils ne coûtent pas
    la même chose. Aucun chemin n'est dans les deux — un fichier indexé n'est
    plus non suivi — donc la soustraction est exacte.
  */
  import { t } from "../i18n.svelte";
  import { repo } from "../stores/repo.svelte";

  let { style, onclose }: { style: string; onclose: () => void } = $props();

  const untrackedCount = $derived(repo.status?.untracked.length ?? 0);
  const trackedCount = $derived(repo.changeCount - untrackedCount);

  async function discard() {
    onclose();
    await repo.discardAll();
  }
</script>

<!-- Superposition qui referme au clic à côté, comme les menus. -->
<button class="scrim" aria-label={t("action.cancel")} onclick={onclose}></button>
<div class="confirm" {style} role="dialog" aria-label={t("status.discard.title")}>
  <p class="c-title">{t("status.discard.title")}</p>
  <p class="c-text">
    {#if trackedCount > 0}{t("status.discard.tracked", { n: trackedCount })}{/if}
    {#if untrackedCount > 0}{t("status.discard.untracked", { n: untrackedCount })}{/if}
    {t("status.discard.warning")}
  </p>
  <div class="c-actions">
    <button class="c-cancel" onclick={onclose}>{t("action.cancel")}</button>
    <button class="c-ok" onclick={discard}>{t("status.discardAll")}</button>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: transparent;
    border: none;
    padding: 0;
    cursor: default;
  }
  /* La position vient de l'appelant (`style`) ; le reste est commun. */
  .confirm {
    z-index: 51;
    padding: 0.6rem;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 8px 24px var(--shadow-color);
    user-select: none;
    -webkit-user-select: none;
  }
  .c-title {
    margin: 0 0 0.35rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text);
  }
  .c-text {
    margin: 0 0 0.6rem;
    color: var(--text-dim);
    font-size: 0.75rem;
    line-height: 1.35;
  }
  .c-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
  }
  .c-actions button {
    font-size: 0.75rem;
    padding: 0.2rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .c-cancel {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
  }
  .c-cancel:hover {
    border-color: var(--accent);
  }
  .c-ok {
    background: var(--danger);
    border: 1px solid var(--danger);
    color: var(--accent-text);
  }
  .c-ok:hover {
    filter: brightness(1.1);
  }
</style>

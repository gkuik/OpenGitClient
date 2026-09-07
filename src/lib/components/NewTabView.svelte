<script lang="ts">
  import { t } from "../i18n.svelte";
  import { tabs } from "../stores/repo.svelte";

  // Corps de la fenêtre quand l'onglet actif est une page « Nouvel onglet »
  // (voir `NewTab`) : elle remplace les trois colonnes, la barre d'onglets
  // restant au-dessus — comme l'écran Paramètres.
  //
  // Seule l'ouverture d'un dépôt local est branchée ; cloner et créer n'ont
  // aucun backend derrière eux, donc ils sont rendus désactivés plutôt
  // qu'absents : la page annonce ce qui existera sans en promettre l'usage.
</script>

<div class="newtab">
  <div class="card">
    <h1>{t("newTab.title")}</h1>
    <p class="sub">{t("newTab.subtitle")}</p>

    <div class="actions">
      <button class="action" disabled={tabs.opening} onclick={() => tabs.openFromDialog()}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1.5 12.5v-9a1 1 0 0 1 1-1h3.2l1.5 1.8h6.3a1 1 0 0 1 1 1v7.2a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
        </svg>
        <span class="label">{t("newTab.open.label")}</span>
        <span class="hint">{t("newTab.open.hint")}</span>
      </button>

      <button class="action" disabled title={t("common.notAvailable")}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4.4 6.2a3.6 3.6 0 0 1 7-.8 2.7 2.7 0 0 1-.4 5.4H5a3 3 0 0 1-.6-5.9z" />
          <path d="M8 8.6v3.9M6.4 10.9 8 12.5l1.6-1.6" />
        </svg>
        <span class="label">{t("newTab.clone.label")}</span>
        <span class="hint">{t("newTab.soon")}</span>
      </button>

      <button class="action" disabled title={t("common.notAvailable")}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.4" />
          <path d="M8 5.4v5.2M5.4 8h5.2" />
        </svg>
        <span class="label">{t("newTab.create.label")}</span>
        <span class="hint">{t("newTab.soon")}</span>
      </button>
    </div>

    {#if tabs.recent.length > 0}
      <div class="recent">
        <span class="rlabel">{t("common.recent")}</span>
        {#each tabs.recent as r (r.path)}
          <button class="item" title={r.path} onclick={() => tabs.open(r.path)}>
            <span class="rname">{r.name}</span>
            <span class="rpath">{r.path}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .newtab {
    display: flex;
    justify-content: center;
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    padding: 3rem 1.5rem 2rem;
  }
  .card {
    display: flex;
    flex-direction: column;
    width: min(44rem, 100%);
    /* Le contenu ne s'étire pas sur la hauteur : la page reste en haut, où le
       « + » vient de la faire apparaître. */
    align-self: flex-start;
  }
  h1 {
    margin: 0;
    font-size: 1.4rem;
    letter-spacing: 0.02em;
    color: var(--accent-soft);
  }
  .sub {
    margin: 0.25rem 0 1.4rem;
    color: var(--text-dim);
    font-size: 0.9rem;
  }
  /* Trois tuiles de largeur égale, qui repassent en colonne dans une fenêtre
     étroite plutôt que d'écraser leurs libellés. */
  .actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.6rem;
  }
  .action {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
    text-align: left;
    padding: 0.9rem 0.9rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-raised);
    color: var(--text);
    cursor: pointer;
  }
  .action:hover:not(:disabled) {
    border-color: var(--accent);
    background: var(--accent-bg);
  }
  .action:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .action svg {
    width: 18px;
    height: 18px;
    margin-bottom: 0.35rem;
    color: var(--accent-soft);
  }
  .label {
    font-size: 0.88rem;
    font-weight: 600;
  }
  .hint {
    font-size: 0.75rem;
    color: var(--text-faint);
  }
  .recent {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    margin-top: 1.8rem;
  }
  .rlabel {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
    margin-bottom: 0.2rem;
  }
  .item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 0.4rem 0.6rem;
    cursor: pointer;
    min-width: 0;
    width: 100%;
  }
  .item:hover {
    background: var(--bg-raised);
    border-color: var(--border);
  }
  .rname {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text);
  }
  .rpath {
    font-size: 0.72rem;
    color: var(--text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
</style>

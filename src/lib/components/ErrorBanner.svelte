<script lang="ts">
  import { repo, tabs } from "../stores/repo.svelte";

  // Deux sources : l'échec d'ouverture d'un dépôt (qui n'appartient à aucun
  // onglet, et reste le seul affichable quand il n'y en a aucun) et l'erreur de
  // l'onglet actif. La première est prioritaire car elle vient d'être provoquée.
  const error = $derived(tabs.openError ?? repo.error);

  function dismiss() {
    if (tabs.openError) tabs.openError = null;
    else repo.clearError();
  }
</script>

{#if error}
  <div class="error" role="alert">
    <span class="kind">{error.kind}</span>
    <span class="msg">{error.message}</span>
    <button class="close" onclick={dismiss} aria-label="Fermer">×</button>
  </div>
{/if}

<style>
  .error {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    background: #7f1d1d;
    color: #fee2e2;
    padding: 0.5rem 0.8rem;
    border-radius: 6px;
    font-size: 0.85rem;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  }
  .kind {
    font-weight: 600;
    background: rgba(0, 0, 0, 0.25);
    padding: 0.05rem 0.4rem;
    border-radius: 4px;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .msg {
    flex: 1;
  }
  .close {
    background: transparent;
    border: none;
    color: inherit;
    font-size: 1.15rem;
    line-height: 1;
    cursor: pointer;
    padding: 0 0.15rem;
  }
</style>

<script lang="ts">
  import { repo } from "../stores/repo.svelte";

  // Confirmation en deux temps : abandonner jette la résolution en cours, et
  // aucune capacité de dialogue natif n'est déclarée.
  let confirming = $state(false);

  async function abort() {
    confirming = false;
    await repo.abortMerge();
  }
</script>

<!--
  Sortie de secours d'un pull qui a conflité. Sans elle, un conflit laisserait
  l'utilisateur coincé : l'application n'a pas d'autre moyen de refermer une
  fusion, et rien n'indiquerait pourquoi le prochain commit aura deux parents.
-->
{#if repo.merging}
  <div class="merge" role="status">
    <p class="text">
      <strong>Fusion en cours.</strong>
      Résous les fichiers en conflit, indexe-les, puis committe — le commit reprendra
      les deux branches.
    </p>
    {#if confirming}
      <div class="row">
        <button class="danger" onclick={abort} disabled={repo.busy}>
          Confirmer l'abandon
        </button>
        <button class="quiet" onclick={() => (confirming = false)}>Annuler</button>
      </div>
    {:else}
      <button class="quiet" onclick={() => (confirming = true)} disabled={repo.busy}>
        Abandonner la fusion
      </button>
    {/if}
  </div>
{/if}

<style>
  .merge {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.5rem 0.6rem;
    border-bottom: 1px solid var(--border);
    background: rgba(250, 204, 21, 0.12);
  }
  .text {
    margin: 0;
    font-size: 0.76rem;
    line-height: 1.35;
    color: var(--text);
  }
  .row {
    display: flex;
    gap: 0.4rem;
  }
  button {
    align-self: flex-start;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--bg-raised);
    color: var(--text);
    font-size: 0.74rem;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: var(--bg);
  }
  button:disabled {
    color: var(--text-faint);
    cursor: default;
  }
  .danger {
    color: #f87171;
    border-color: rgba(248, 113, 113, 0.5);
  }
</style>

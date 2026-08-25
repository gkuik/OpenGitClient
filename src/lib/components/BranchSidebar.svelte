<script lang="ts">
  import { repo } from "../stores/repo.svelte";
  import { buildBranchTree } from "../tree";
  import BranchRow from "./BranchRow.svelte";

  // D'autres catégories (REMOTE, TAGS…) viendront s'ajouter ici : chacune est
  // une <section> autonome sur ce même modèle.
  let localOpen = $state(true);
  let stashesOpen = $state(true);

  const nodes = $derived(buildBranchTree(repo.branches));
</script>

<nav class="branches">
  {#if !repo.repoInfo}
    <p class="empty">Aucun dépôt ouvert.</p>
  {:else}
    <section>
      <header>
        <button class="sec-title" onclick={() => (localOpen = !localOpen)} aria-expanded={localOpen}>
          <span class="chev" class:open={localOpen}>▶</span>
          <svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
            <rect x="2.5" y="3" width="11" height="7.5" rx="1" />
            <path d="M1 12.5h14" stroke-linecap="round" />
          </svg>
          LOCAL
        </button>
        <span class="count">{repo.branches.length}</span>
      </header>

      {#if localOpen}
        <div class="sec-body">
          {#each nodes as node (node.type === "dir" ? "d:" + node.path : "b:" + node.branch.name)}
            <BranchRow {node} />
          {:else}
            <p class="empty small">Aucune branche.</p>
          {/each}
        </div>
      {/if}
    </section>

    <section>
      <header>
        <button
          class="sec-title"
          onclick={() => (stashesOpen = !stashesOpen)}
          aria-expanded={stashesOpen}
        >
          <span class="chev" class:open={stashesOpen}>▶</span>
          {@render stashIcon()}
          STASHES
        </button>
        <span class="count">{repo.stashes.length}</span>
      </header>

      {#if stashesOpen}
        <div class="sec-body">
          {#each repo.stashes as stash (stash.oid)}
            <!-- Lecture seule pour l'instant : appliquer/supprimer viendra plus tard. -->
            <div class="stash" title={stash.message}>
              {@render stashIcon()}
              <span class="on">on:</span>
              <span class="sbranch">{stash.branch ?? stash.message}</span>
            </div>
          {:else}
            <p class="empty small">Aucun stash.</p>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</nav>

<!-- Icône « bac de rangement », partagée par l'en-tête et les entrées. -->
{#snippet stashIcon()}
  <svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
    <path d="M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" />
    <path d="M1.5 8.75h3.2l1 1.6h4.6l1-1.6h3.2" stroke-linecap="round" />
  </svg>
{/snippet}

<style>
  .branches {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
    border-right: 1px solid var(--border);
    background: var(--bg);
  }
  section {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.6rem;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--bg);
  }
  .sec-title {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: transparent;
    border: none;
    color: var(--text);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    cursor: pointer;
    padding: 0;
  }
  .chev {
    display: inline-block;
    width: 0.7rem;
    font-size: 0.55rem;
    color: var(--text-faint);
    transition: transform 0.1s ease;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .ic {
    width: 14px;
    height: 14px;
    color: var(--text-dim);
  }
  .count {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent-soft);
  }
  .sec-body {
    padding: 0.3rem 0.3rem 0.6rem;
  }
  .stash {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.82rem;
  }
  .stash:hover {
    background: var(--bg-raised);
  }
  .stash .ic {
    color: var(--text-faint);
  }
  .on {
    flex: none;
    color: var(--text);
  }
  .sbranch {
    flex: 1;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty {
    color: var(--text-dim);
    font-size: 0.8rem;
    padding: 1rem 0.7rem;
  }
  .empty.small {
    padding: 0.3rem 0.6rem;
    opacity: 0.7;
  }
</style>

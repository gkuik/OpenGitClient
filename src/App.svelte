<script lang="ts">
  import { onMount } from "svelte";
  import { repo } from "./lib/stores/repo.svelte";
  import RepoSelector from "./lib/components/RepoSelector.svelte";
  import BranchSidebar from "./lib/components/BranchSidebar.svelte";
  import StatusPanel from "./lib/components/StatusPanel.svelte";
  import CenterPanel from "./lib/components/CenterPanel.svelte";
  import CommitDetailsPanel from "./lib/components/CommitDetailsPanel.svelte";
  import CommitBox from "./lib/components/CommitBox.svelte";
  import ErrorBanner from "./lib/components/ErrorBanner.svelte";

  onMount(() => {
    repo.init();
  });
</script>

<div class="app">
  <header class="topbar">
    <div class="brand">GitLite</div>
    <RepoSelector />
  </header>

  <div class="body">
    <BranchSidebar />
    <main class="main">
      <CenterPanel />
    </main>
    <!--
      La colonne de droite est le sélecteur de fichiers de ce qu'on regarde :
      le détail du commit quand un commit est sélectionné, sinon les changements
      en cours et la boîte de commit.
    -->
    <aside class="sidebar">
      {#if repo.selectedCommitOid}
        <CommitDetailsPanel />
      {:else}
        <StatusPanel />
        <CommitBox />
      {/if}
    </aside>
  </div>

  <!-- Bandeau d'erreur en overlay (ne rend rien s'il n'y a pas d'erreur). -->
  <div class="error-overlay">
    <ErrorBanner />
  </div>
</div>

<style>
  .app {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100vh;
    overflow: hidden;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 0.9rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  .brand {
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--accent-soft);
    white-space: nowrap;
  }
  .body {
    display: grid;
    /* Branches à gauche · graph/diff au centre · statut + commit à droite. */
    grid-template-columns: var(--sidebar-w) 1fr var(--sidebar-w);
    min-height: 0;
    /* Sans ça, une colonne au contenu large pousse la grille et fait défiler
       toute l'application horizontalement. */
    overflow: hidden;
  }
  .sidebar {
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--border);
    min-height: 0;
  }
  .main {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .error-overlay {
    position: fixed;
    left: 50%;
    bottom: 1rem;
    transform: translateX(-50%);
    max-width: min(680px, 90vw);
    z-index: 100;
  }
</style>

<script lang="ts">
  import { onMount } from "svelte";
  import { repo, tabs } from "./lib/stores/repo.svelte";
  import TabBar from "./lib/components/TabBar.svelte";
  import WelcomeScreen from "./lib/components/WelcomeScreen.svelte";
  import SettingsView from "./lib/components/SettingsView.svelte";
  import BranchSidebar from "./lib/components/BranchSidebar.svelte";
  import StatusPanel from "./lib/components/StatusPanel.svelte";
  import CenterPanel from "./lib/components/CenterPanel.svelte";
  import CommitDetailsPanel from "./lib/components/CommitDetailsPanel.svelte";
  import CommitBox from "./lib/components/CommitBox.svelte";
  import ErrorBanner from "./lib/components/ErrorBanner.svelte";
  import CredentialsDialog from "./lib/components/CredentialsDialog.svelte";
  import MergeBanner from "./lib/components/MergeBanner.svelte";

  onMount(() => {
    // Restaure les onglets de la session précédente.
    tabs.init();
  });
</script>

<div class="app">
  <!-- La barre d'onglets tient lieu de topbar : pas de logo ni de bouton d'ouverture. -->
  <TabBar />

  <!-- Les paramètres occupent tout le corps, par-dessus l'accueil comme par
       dessus un dépôt ouvert : la barre d'onglets, elle, reste accessible. -->
  {#if tabs.settingsOpen}
    <SettingsView />
  {:else if !tabs.hasTabs}
    <WelcomeScreen />
  {:else}
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
        <!-- Au-dessus des deux vues : une fusion en cours concerne le dépôt,
             pas ce qu'on est en train de regarder. -->
        <MergeBanner />
        {#if repo.selectedCommitOid}
          <CommitDetailsPanel />
        {:else}
          <StatusPanel />
          <CommitBox />
        {/if}
      </aside>
    </div>
  {/if}

  <!-- Saisie d'identifiants pour un dépôt distant (ne rend rien sans demande). -->
  <CredentialsDialog />

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

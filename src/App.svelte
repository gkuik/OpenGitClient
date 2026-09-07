<script lang="ts">
  import { onMount } from "svelte";
  import { repo, tabs } from "./lib/stores/repo.svelte";
  import TabBar from "./lib/components/TabBar.svelte";
  import WelcomeScreen from "./lib/components/WelcomeScreen.svelte";
  import NewTabView from "./lib/components/NewTabView.svelte";
  import SettingsView from "./lib/components/SettingsView.svelte";
  import RepoBar from "./lib/components/RepoBar.svelte";
  import BranchSidebar from "./lib/components/BranchSidebar.svelte";
  import StatusPanel from "./lib/components/StatusPanel.svelte";
  import CenterPanel from "./lib/components/CenterPanel.svelte";
  import CommitDetailsPanel from "./lib/components/CommitDetailsPanel.svelte";
  import CommitBox from "./lib/components/CommitBox.svelte";
  import ErrorBanner from "./lib/components/ErrorBanner.svelte";
  import CredentialsDialog from "./lib/components/CredentialsDialog.svelte";
  import MergeBanner from "./lib/components/MergeBanner.svelte";
  import SidebarResizer from "./lib/components/SidebarResizer.svelte";

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
    <!-- Un onglet sans dépôt : sa page d'accueil prend la place des trois
         colonnes, la barre d'onglets restant au-dessus. -->
  {:else if tabs.activeIsNew}
    <NewTabView />
  {:else}
    <!-- Le dépôt occupe la rangée souple de `.app` : sa barre en haut, puis les
         trois colonnes. Un conteneur plutôt qu'une rangée de plus dans `.app` —
         les trois autres vues (accueil, nouvel onglet, paramètres) n'ont pas de
         barre, et une rangée déclarée mais vide décalerait leur hauteur. -->
    <div class="repo">
      <!-- Nom du dépôt · Pull / Push / Fetch · compte rendu. Ces trois actions
           concernent le dépôt entier : elles ont quitté la colonne des branches,
           qui n'en portait qu'à titre de voisinage. -->
      <RepoBar />

      <div class="body">
        <BranchSidebar />
        <!-- Poignées posées sur les deux frontières : hors de la grille, elles
             ne déplacent aucune colonne (voir SidebarResizer). -->
        <SidebarResizer side="left" />
        <SidebarResizer side="right" />
        <main class="main">
          <CenterPanel />
        </main>
        <!--
          La colonne de droite est le sélecteur de fichiers de ce qu'on regarde :
          le détail du commit quand un commit est sélectionné, sinon les
          changements en cours et la boîte de commit.
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
  /* La barre du dépôt puis les trois colonnes, qui prennent tout le reste. */
  .repo {
    display: grid;
    grid-template-rows: auto 1fr;
    min-height: 0;
    overflow: hidden;
  }
  .body {
    display: grid;
    /* Branches à gauche · graph/diff au centre · statut + commit à droite. Les
       deux largeurs sont réglables séparément à la souris ; leur variable est
       réécrite par `layout.svelte.ts`. */
    grid-template-columns: var(--sidebar-l-w) 1fr var(--sidebar-r-w);
    min-height: 0;
    /* Repère des poignées de redimensionnement, qui se placent en absolu sur
       les frontières. */
    position: relative;
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

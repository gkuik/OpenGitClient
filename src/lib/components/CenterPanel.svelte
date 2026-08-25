<script lang="ts">
  import { repo } from "../stores/repo.svelte";
  import GraphView from "./GraphView.svelte";
  import DiffViewer from "./DiffViewer.svelte";

  // Pas d'état d'onglet : ouvrir un fichier montre son diff, le refermer
  // (croix du diff) ramène au graph.
  const showDiff = $derived(repo.diffTarget !== null);
</script>

<!--
  Les deux vues restent montées et on masque l'inactive : revenir au graph ne
  doit ni remonter le canvas ni perdre la position de scroll de l'historique.
  `visibility` (et non `display: none`) préserve la mise en page, donc la hauteur
  que le graph mesure pour dimensionner son canvas.
-->
<div class="center">
  <div class="pane" class:hidden={showDiff}>
    <GraphView />
  </div>

  <div class="pane" class:hidden={!showDiff}>
    <DiffViewer />
  </div>
</div>

<style>
  .center {
    position: relative;
    height: 100%;
    min-height: 0;
  }
  .pane {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .pane.hidden {
    visibility: hidden;
    pointer-events: none;
  }
</style>

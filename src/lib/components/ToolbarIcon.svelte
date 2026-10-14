<script lang="ts">
  /*
    Icône d'un élément de la barre du dépôt. Elles vivaient dans `RepoBar` ; la
    palette de personnalisation a besoin des mêmes, d'où ce composant.

    Le tracé remplit sa boîte (`display: block`, 100 %) : c'est l'appelant qui
    la dimensionne — et qui l'anime (la flèche du fetch qui tourne, celle du
    pull qui descend) en animant cette boîte.
  */
  import type { ToolbarItem } from "../toolbar";

  let { item }: { item: ToolbarItem } = $props();
</script>

<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if item === "pull"}
    <!-- Flèche descendante vers une base : le distant vient jusqu'au local. -->
    <path d="M8 1.75v7.5" />
    <path d="M4.75 6 8 9.25 11.25 6" />
    <path d="M3 13.25h10" />
  {:else if item === "push"}
    <!-- Flèche montante depuis une base : le local part vers le distant. -->
    <path d="M8 14.25v-7.5" />
    <path d="M4.75 10 8 6.75 11.25 10" />
    <path d="M3 2.75h10" />
  {:else if item === "fetch"}
    <!-- Flèche circulaire : rapatrie les références sans toucher au working dir. -->
    <path d="M13.4 9.2A5.5 5.5 0 1 1 12 4.2" />
    <path d="M9.4 4.6 12 4.2l-.4-2.6" />
  {:else if item === "branch"}
    <!-- Une branche qui se détache d'une ligne : celle de la sidebar, agrandie. -->
    <circle cx="4.5" cy="3.5" r="1.75" />
    <circle cx="4.5" cy="12.5" r="1.75" />
    <circle cx="11.5" cy="5" r="1.75" />
    <path d="M4.5 5.25v5.5" />
    <path d="M9.75 6.4A5 5 0 0 1 6.2 11.9" />
  {:else if item === "stash"}
    <!-- Le bac de rangement de la section STASHES, agrandi. -->
    <path d="M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" />
    <path d="M1.5 8.75h3.2l1 1.6h4.6l1-1.6h3.2" />
  {:else if item === "gitflow"}
    <!-- Deux lignes pérennes et une branche de l'une à l'autre : le va-et-vient
         des branches de travail entre `develop` et `main`. -->
    <circle cx="4" cy="3.5" r="1.75" />
    <circle cx="12" cy="12.5" r="1.75" />
    <path d="M4 5.25v9" />
    <path d="M12 1.75v9" />
    <path d="M4 6.5c0 3 8 2 8 4.25" />
  {:else if item === "separator"}
    <!-- Le filet tel qu'il se dessine dans la barre. -->
    <path d="M8 1.5v13" />
  {:else}
    <!-- Un espace : une place vide, bornée. -->
    <path d="M2 4.5v7M14 4.5v7M4.5 8h7" stroke-dasharray="1.5 1.5" />
  {/if}
</svg>

<style>
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>

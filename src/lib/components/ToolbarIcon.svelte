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
  {:else if item === "pop"}
    <!-- Le bac du stash, dont une flèche ressort : le dernier rangé revient. -->
    <path d="M1.5 9.5v3a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-3" />
    <path d="M1.5 9.5h3.2l1 1.5h4.6l1-1.5h3.2" />
    <path d="M8 8V1.75" />
    <path d="M5.5 4.25 8 1.75l2.5 2.5" />
  {:else if item === "tag"}
    <!-- L'étiquette des pastilles de tag du graph, agrandie. -->
    <path d="M1.75 2.75v4.6a1 1 0 0 0 .3.7l6.4 6.4a1 1 0 0 0 1.4 0l4.1-4.1a1 1 0 0 0 0-1.4l-6.4-6.4a1 1 0 0 0-.7-.3h-4.6a.5.5 0 0 0-.5.5z" />
    <circle cx="5" cy="5" r="1" />
  {:else if item === "stage-all"}
    <!-- Deux fichiers et un « + » : tout passe dans l'index. -->
    <path d="M4.5 1.75h5l2.5 2.5v6" />
    <path d="M2.5 4.25h6.25l1.75 1.75v8.25h-8z" />
    <path d="M6.5 8v4M4.5 10h4" />
  {:else if item === "unstage-all"}
    <!-- Les mêmes fichiers et un « − » : tout ressort de l'index. -->
    <path d="M4.5 1.75h5l2.5 2.5v6" />
    <path d="M2.5 4.25h6.25l1.75 1.75v8.25h-8z" />
    <path d="M4.5 10h4" />
  {:else if item === "discard-all"}
    <!-- Flèche de retour : tout revient à HEAD, comme le ↺ de la colonne. -->
    <path d="M2.75 8a5.25 5.25 0 1 0 1.6-3.8" />
    <path d="M2.5 1.75v2.9h2.9" />
  {:else if item === "forge"}
    <!-- Une fenêtre et une flèche qui en sort : la page s'ouvre ailleurs,
         dans le navigateur. Pas de logo : le libellé dit déjà où. -->
    <path d="M7 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9" />
    <path d="M9.5 1.75h4.75V6.5" />
    <path d="M14.25 1.75 7.5 8.5" />
  {:else if item === "finder"}
    <!-- Un dossier ouvert : le dépôt montré là où il est rangé. -->
    <path d="M1.75 12.5V3.5a1 1 0 0 1 1-1h3l1.5 1.75h5.5a1 1 0 0 1 1 1V6.5" />
    <path d="M1.75 12.5 3.6 7.2a1 1 0 0 1 .95-.7h9.2a.75.75 0 0 1 .7 1l-1.7 5a1 1 0 0 1-.95.7H2.75a1 1 0 0 1-1-.7z" />
  {:else if item === "terminal"}
    <!-- Une fenêtre, une invite et un curseur. -->
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M4.25 6.25 6.5 8.25l-2.25 2" />
    <path d="M8.25 10.5h3.5" />
  {:else if item === "editor"}
    <!-- Des chevrons de code : le dépôt ouvert dans un éditeur. -->
    <path d="M5.25 4.25 1.75 8l3.5 3.75" />
    <path d="M10.75 4.25 14.25 8l-3.5 3.75" />
    <path d="M9.25 2.75 6.75 13.25" />
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

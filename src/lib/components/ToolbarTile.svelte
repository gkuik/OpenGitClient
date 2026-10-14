<script lang="ts">
  /*
    Un élément de la barre du dépôt **tel qu'il se dessine**, inerte : ce que
    montrent la barre en cours de personnalisation, la palette, la barre par
    défaut et l'étiquette qui suit le curseur. Mêmes dimensions que les boutons
    de `RepoBar` (48px, icône au-dessus du libellé) — ce qu'on dépose est ce
    qu'on verra.

    Dans la barre (`inBar`), le séparateur et l'espace prennent leur forme
    réelle, sans libellé : un filet, une place vide — en pointillés, sans quoi
    on ne pourrait pas l'attraper. Dans la palette, ils ont un libellé comme
    les actions.
  */
  import type { ToolbarItem } from "../toolbar";
  import { itemLabel } from "../toolbar.svelte";
  import ToolbarIcon from "./ToolbarIcon.svelte";

  let {
    item,
    inBar = false,
    muted = false,
  }: {
    item: ToolbarItem;
    inBar?: boolean;
    /** Grisé : Git Flow sur un dépôt où il n'est pas activé. */
    muted?: boolean;
  } = $props();
</script>

{#if inBar && item === "separator"}
  <span class="sep-tile"><span class="line"></span></span>
{:else if inBar && item === "space"}
  <span class="space-tile"><span class="box"></span></span>
{:else}
  <span class="tile" class:wide={item === "gitflow"} class:muted>
    <span class="ic"><ToolbarIcon {item} /></span>
    {#if item === "gitflow"}
      <span class="drop">
        <span>{itemLabel(item)}</span>
        <svg class="drop-ic" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M3.5 6 8 10.5 12.5 6Z" />
        </svg>
      </span>
    {:else}
      <span>{itemLabel(item)}</span>
    {/if}
  </span>
{/if}

<style>
  /* Les cotes de `.action` dans `RepoBar` : à garder en accord. */
  .tile {
    flex: none;
    width: 48px;
    height: 48px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    color: var(--text);
    font-size: 0.7rem;
    white-space: nowrap;
  }
  .tile.wide {
    width: auto;
    min-width: 48px;
    padding: 0 0.45rem;
  }
  .tile.muted {
    opacity: 0.45;
  }
  .ic {
    display: block;
    width: 20px;
    height: 20px;
  }
  .drop {
    display: flex;
    align-items: center;
    gap: 0.15rem;
  }
  .drop-ic {
    display: block;
    width: 0.6rem;
    height: 0.6rem;
    color: var(--text-faint);
  }

  /* Le filet de la barre, **exactement** à l'encombrement de `.group-sep`
     (1px et 0.3rem de marge de chaque côté) : passer en personnalisation ne
     doit décaler aucun bouton. Les marges deviennent la zone de saisie. */
  .sep-tile {
    flex: none;
    width: calc(1px + 0.6rem);
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .line {
    width: 1px;
    height: 28px;
    background: var(--border);
  }
  /* La largeur d'un espace dans la barre (`.space`), rendue visible. */
  .space-tile {
    flex: none;
    width: 24px;
    height: 48px;
    display: flex;
    align-items: center;
  }
  .box {
    width: 100%;
    height: 32px;
    border: 1px dashed var(--text-faint);
    border-radius: 4px;
  }
</style>

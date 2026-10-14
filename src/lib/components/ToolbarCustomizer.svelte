<script lang="ts">
  /*
    Écran de personnalisation de la barre du dépôt — celui de la barre d'outils
    du Finder. La barre elle-même passe en mode édition (`RepoBar`, quand
    `toolbar.editing`) ; ce composant pose le reste : un voile sur la fenêtre,
    le panneau sous la barre, et l'étiquette qui suit le curseur.

    Modal comme une feuille macOS : le voile n'écoute rien, on sort par Done ou
    Échap. Le panneau est en `fixed` sous la barre plutôt qu'à l'intérieur : la
    barre est une grille, et le voile doit passer **entre** elle et le reste —
    d'où les trois étages, voile 60, barre 61 (`.repobar.editing`), panneau 62.
  */
  import { onMount } from "svelte";
  import { t } from "../i18n.svelte";
  import { repo } from "../stores/repo.svelte";
  import { DEFAULT_TOOLBAR, PALETTE, type ToolbarItem } from "../toolbar";
  import { toolbar } from "../toolbar.svelte";
  import ToolbarTile from "./ToolbarTile.svelte";

  let { bar }: { bar: HTMLElement | null } = $props();

  /** Bas de la barre, en coordonnées fenêtre : là où le panneau s'accroche. */
  let top = $state(0);
  let doneEl = $state<HTMLButtonElement | null>(null);

  function measure() {
    top = bar ? bar.getBoundingClientRect().bottom : 0;
  }

  onMount(() => {
    measure();
    // Le focus sur Done : Entrée referme, comme dans le Finder, et la palette
    // est à une tabulation en arrière.
    doneEl?.focus({ focusVisible: false } as FocusOptions);
  });

  /** L'élément que l'étiquette représente, pour un glissement venu d'un seul. */
  function draggedItem(): ToolbarItem | null {
    const source = toolbar.drag?.source;
    if (!source || source.kind === "default") return null;
    return source.kind === "palette" ? source.item : (toolbar.items[source.index] ?? null);
  }

  function addFromPalette(item: ToolbarItem) {
    if (toolbar.consumeClick()) return;
    toolbar.append(item);
  }

  function resetFromDefault() {
    if (toolbar.consumeClick()) return;
    toolbar.reset();
  }
</script>

<svelte:window onresize={measure} />

<div class="scrim" aria-hidden="true"></div>

<div
  class="panel"
  style="top: {top + 8}px"
  role="dialog"
  aria-modal="true"
  aria-label={t("toolbar.custom.title")}
>
  <p class="lead">{t("toolbar.custom.palette")}</p>
  <div class="palette">
    {#each PALETTE as item (item)}
      <button
        class="cell"
        title={t("toolbar.custom.add.hint")}
        onpointerdown={(e) => toolbar.startDrag(e, { kind: "palette", item }, bar)}
        onclick={() => addFromPalette(item)}
      >
        <ToolbarTile {item} />
      </button>
    {/each}
  </div>

  <p class="lead">{t("toolbar.custom.default")}</p>
  <button
    class="default"
    title={t("toolbar.custom.default.hint")}
    onpointerdown={(e) => toolbar.startDrag(e, { kind: "default" }, bar)}
    onclick={resetFromDefault}
  >
    {#each DEFAULT_TOOLBAR as item, i (i)}
      <ToolbarTile {item} inBar />
    {/each}
  </button>

  <div class="foot">
    <p class="hint">{t("toolbar.custom.hint")}</p>
    <button class="done" bind:this={doneEl} onclick={() => toolbar.stopEditing()}>
      {t("action.done")}
    </button>
  </div>
</div>

<!-- L'étiquette qui suit le curseur. Hors de la barre, un élément qui en vient
     pâlit : le lâcher là le retire. -->
{#if toolbar.drag}
  {@const item = draggedItem()}
  <div
    class="ghost"
    class:removing={toolbar.drag.source.kind === "bar" && !toolbar.drag.over}
    style="left: {toolbar.drag.x}px; top: {toolbar.drag.y}px"
    aria-hidden="true"
  >
    {#if item}
      <ToolbarTile {item} inBar={toolbar.drag.source.kind === "bar"} muted={item === "gitflow" && !repo.flowEnabled} />
    {:else}
      {#each DEFAULT_TOOLBAR as d, i (i)}
        <ToolbarTile item={d} inBar />
      {/each}
    {/if}
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: var(--scrim);
  }
  .panel {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    z-index: 62;
    width: min(720px, calc(100vw - 32px));
    max-height: calc(100vh - 120px);
    overflow-y: auto;
    padding: 1rem 1.25rem;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 16px 48px var(--shadow-color);
    user-select: none;
    -webkit-user-select: none;
  }
  .lead {
    margin: 0 0 0.6rem;
    font-size: 0.82rem;
    color: var(--text-dim);
  }
  .palette {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.75rem;
    margin-bottom: 1.25rem;
  }
  .cell,
  .default {
    display: flex;
    align-items: center;
    padding: 0.25rem;
    border: 1px solid transparent;
    border-radius: 7px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: grab;
    touch-action: none;
  }
  .cell:hover {
    background: var(--bg);
    border-color: var(--border);
  }
  /* La barre par défaut, posée dans un bandeau comme celle du Finder. */
  .default {
    gap: 0.4rem;
    width: 100%;
    justify-content: center;
    padding: 0.4rem 0.75rem;
    background: var(--bg);
    border-color: var(--border);
  }
  .default:hover {
    border-color: var(--accent);
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }
  .hint {
    flex: 1;
    margin: 0;
    font-size: 0.74rem;
    color: var(--text-faint);
  }
  .done {
    flex: none;
    padding: 0.35rem 1rem;
    border: 1px solid transparent;
    border-radius: 5px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 0.8rem;
    font-family: inherit;
    cursor: pointer;
  }

  .ghost {
    position: fixed;
    z-index: 70;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0 0.25rem;
    border-radius: 7px;
    background: var(--bg-raised);
    box-shadow: 0 8px 24px var(--shadow-color);
    pointer-events: none;
    transition: opacity 120ms ease;
  }
  .ghost.removing {
    opacity: 0.45;
  }
</style>

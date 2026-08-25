<script lang="ts">
  import { repo } from "../stores/repo.svelte";
  import { buildBranchTree } from "../tree";
  import BranchRow from "./BranchRow.svelte";

  // D'autres catégories (REMOTE, TAGS…) viendront s'ajouter ici : chacune est
  // une <section> autonome sur ce même modèle.
  let localOpen = $state(true);
  let stashesOpen = $state(true);

  const nodes = $derived(buildBranchTree(repo.branches));

  // ── Menu contextuel des stashes ─────────────────────────────────────────────
  // Une seule instance ouverte à la fois, positionnée en coordonnées fenêtre.
  let menu = $state<{ x: number; y: number; index: number } | null>(null);
  // La suppression est irréversible : elle demande une confirmation en deux temps
  // dans le menu, sans dialogue natif (aucune capacité de confirmation déclarée).
  let confirmDrop = $state(false);

  const MENU_W = 184;
  const MENU_H = 148;

  function openAt(x: number, y: number, index: number) {
    // Garde le menu entièrement visible dans la fenêtre.
    menu = {
      x: Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - MENU_H - 8)),
      index,
    };
    confirmDrop = false;
  }

  function openFromMouse(e: MouseEvent, index: number) {
    e.preventDefault();
    openAt(e.clientX, e.clientY, index);
  }

  function openFromKey(e: KeyboardEvent, index: number) {
    if (e.key === "Enter" || e.key === " " || e.key === "ContextMenu") {
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      openAt(r.left, r.bottom, index);
    }
  }

  function openFromKebab(e: MouseEvent, index: number) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Aligné sur le bord droit du bouton, juste en dessous.
    openAt(r.right - MENU_W, r.bottom + 2, index);
  }

  function close() {
    menu = null;
    confirmDrop = false;
  }

  async function apply(pop: boolean) {
    const index = menu?.index;
    close();
    if (index !== undefined) await repo.applyStash(index, pop);
  }

  async function drop() {
    const index = menu?.index;
    close();
    if (index !== undefined) await repo.dropStash(index);
  }
</script>

<svelte:window onkeydown={(e) => (e.key === "Escape" ? close() : undefined)} />

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
            <!--
              Clic droit (ou touche menu / Entrée) ouvre les actions ; le bouton
              « ⋮ » offre le même menu à la souris et au clavier.
            -->
            <div
              class="stash"
              class:active={menu?.index === stash.index}
              role="button"
              tabindex="0"
              title={stash.message}
              oncontextmenu={(e) => openFromMouse(e, stash.index)}
              onkeydown={(e) => openFromKey(e, stash.index)}
            >
              {@render stashIcon()}
              <span class="on">on:</span>
              <span class="sbranch">{stash.branch ?? stash.message}</span>
              <button
                class="kebab"
                title="Actions du stash"
                aria-label="Actions du stash"
                onclick={(e) => openFromKebab(e, stash.index)}
              >
                ⋮
              </button>
            </div>
          {:else}
            <p class="empty small">Aucun stash.</p>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</nav>

<!-- Menu contextuel des stashes : superposition qui ferme + menu positionné. -->
{#if menu}
  <button
    class="ctx-overlay"
    aria-label="Fermer le menu"
    onclick={close}
    oncontextmenu={(e) => {
      e.preventDefault();
      close();
    }}
  ></button>
  <div class="ctx-menu" style="left: {menu.x}px; top: {menu.y}px" role="menu">
    <button class="ctx-item" role="menuitem" onclick={() => apply(false)}>
      {@render applyIcon()}
      <span>Appliquer</span>
    </button>
    <button class="ctx-item" role="menuitem" onclick={() => apply(true)}>
      {@render popIcon()}
      <span>Pop (appliquer et retirer)</span>
    </button>
    <div class="ctx-sep"></div>
    {#if confirmDrop}
      <button class="ctx-item danger" role="menuitem" onclick={drop}>
        {@render dropIcon()}
        <span>Confirmer la suppression</span>
      </button>
    {:else}
      <button
        class="ctx-item danger"
        role="menuitem"
        onclick={() => (confirmDrop = true)}
      >
        {@render dropIcon()}
        <span>Supprimer</span>
      </button>
    {/if}
  </div>
{/if}

<!-- Icônes des actions de stash. Trait `currentColor` : suivent la couleur du
     bouton (rouge sur « Supprimer »). -->
{#snippet applyIcon()}
  <!-- Flèche vers le bas dans un bac : ramène le stash dans le working directory. -->
  <svg class="ctx-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 2v6.5" />
    <path d="M5.5 6 8 8.5 10.5 6" />
    <path d="M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
  </svg>
{/snippet}
{#snippet popIcon()}
  <!-- Flèche vers le haut hors du bac : applique puis dépile le stash. -->
  <svg class="ctx-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 13.5V7" />
    <path d="M5.5 9.5 8 7l2.5 2.5" />
    <path d="M2.5 5.5v-1a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1" />
  </svg>
{/snippet}
{#snippet dropIcon()}
  <!-- Corbeille : retire le stash sans l'appliquer. -->
  <svg class="ctx-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 4.5h10" />
    <path d="M5.5 4.5v-1a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1" />
    <path d="M4.6 4.5l.55 8a1 1 0 0 0 1 .93h3.7a1 1 0 0 0 1-.93l.55-8" />
    <path d="M6.75 7v4M9.25 7v4" />
  </svg>
{/snippet}

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
    cursor: default;
  }
  .stash:hover,
  .stash.active {
    background: var(--bg-raised);
  }
  .stash .ic {
    color: var(--text-faint);
  }
  /* Bouton d'actions : discret, révélé au survol / focus / menu ouvert. */
  .kebab {
    flex: none;
    margin-left: 0.1rem;
    width: 1.3rem;
    height: 1.3rem;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-dim);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
  }
  .stash:hover .kebab,
  .stash:focus-within .kebab,
  .stash.active .kebab {
    opacity: 1;
  }
  .kebab:hover {
    background: var(--bg);
    color: var(--text);
  }

  /* ── Menu contextuel ── */
  .ctx-overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: transparent;
    border: none;
    padding: 0;
    cursor: default;
  }
  .ctx-menu {
    position: fixed;
    z-index: 51;
    min-width: 176px;
    padding: 0.25rem;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }
  .ctx-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    color: var(--text);
    font-size: 0.8rem;
    padding: 0.35rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
  }
  /* Suit la couleur du texte du bouton (rouge pour l'action de suppression). */
  .ctx-ic {
    flex: none;
    width: 14px;
    height: 14px;
  }
  .ctx-item:hover {
    background: var(--accent-bg);
  }
  .ctx-item.danger {
    color: #f87171;
  }
  .ctx-item.danger:hover {
    background: rgba(248, 113, 113, 0.14);
  }
  .ctx-sep {
    height: 1px;
    margin: 0.25rem 0.3rem;
    background: var(--border);
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

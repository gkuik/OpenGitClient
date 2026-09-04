<script lang="ts">
  import type { BranchTreeNode } from "../tree";
  import type { BranchEntry, RemoteBranchEntry, Upstream } from "../types";
  import { repo } from "../stores/repo.svelte";
  import BranchRow from "./BranchRow.svelte"; // récursion (auto-import Svelte 5)

  // La même ligne sert aux sections LOCAL et REMOTE : seule l'entrée portée par
  // la feuille change, les dossiers étant identiques de part et d'autre.
  let {
    node,
    depth = 0,
  }: {
    node: BranchTreeNode<BranchEntry | RemoteBranchEntry>;
    depth?: number;
  } = $props();

  /**
   * Une entrée distante porte son distant, une locale son drapeau HEAD : la
   * forme de l'entrée suffit à les distinguer, sans drapeau à propager le long
   * de la récursion.
   */
  function asLocal(b: BranchEntry | RemoteBranchEntry): BranchEntry | null {
    return "remote" in b ? null : b;
  }

  /**
   * Double-clic / Entrée : bascule sur la branche. Sur une distante, le backend
   * crée la branche locale de suivi au passage (`origin/x` → `x`), ou bascule
   * sur celle qui porte déjà ce nom.
   */
  function checkout(b: BranchEntry | RemoteBranchEntry) {
    const local = asLocal(b);
    if (local) repo.checkoutBranch(local.name);
    else repo.checkoutRemoteBranch(b.name);
  }

  /** Clic simple : sélectionne la tête de la branche dans le graph. */
  function selectTip(oid: string) {
    if (oid) repo.selectCommit(oid);
  }

  /**
   * Infobulle des compteurs. Elle nomme l'amont et rappelle d'où vient le
   * chiffre : deux références locales, donc l'état du dernier fetch — pas ce
   * que le serveur contient à l'instant présent.
   */
  function gapHint(up: Upstream): string {
    const parts: string[] = [];
    if (up.ahead > 0) parts.push(`${up.ahead} commit${up.ahead > 1 ? "s" : ""} à pousser`);
    if (up.behind > 0) parts.push(`${up.behind} à récupérer`);
    return `${parts.join(" · ")} — ${up.name}, au dernier fetch`;
  }
</script>

{#if node.type === "branch"}
  {@const local = asLocal(node.branch)}
  {@const current = local?.isHead ?? false}
  {@const selected = repo.selectedCommitOid === node.branch.oid && node.branch.oid !== ""}
  <!--
    Clic simple : sélectionne le dernier commit de la branche dans le graph.
    Double-clic pour basculer (convention GitKraken). `Enter` fait la même chose
    pour garder l'équivalent clavier, le dblclick n'étant pas atteignable autrement.
  -->
  <div
    class="branch"
    class:current
    class:selected
    role="button"
    tabindex="0"
    style="padding-left: {depth * 12 + 8}px"
    title={local
      ? `${local.name} — clic pour voir son dernier commit, double-clic pour basculer`
      : `${node.branch.name} — clic pour voir son dernier commit, double-clic pour basculer (branche locale de suivi créée au besoin)`}
    onclick={() => selectTip(node.branch.oid)}
    ondblclick={() => checkout(node.branch)}
    onkeydown={(e) => (e.key === "Enter" ? checkout(node.branch) : undefined)}
  >
    <span class="mark">{current ? "✓" : ""}</span>
    <svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="4.5" cy="3.5" r="1.75" />
      <circle cx="4.5" cy="12.5" r="1.75" />
      <circle cx="11.5" cy="5" r="1.75" />
      <path d="M4.5 5.25v5.5" stroke-linecap="round" />
      <path d="M9.75 6.4A5 5 0 0 1 6.2 11.9" stroke-linecap="round" />
    </svg>
    <span class="bname">{node.name}</span>
    <!--
      Écart avec l'amont. Un compteur nul n'est pas affiché, et une branche sans
      amont n'en a aucun : la pastille signale un écart, elle ne certifie pas
      une synchronisation.
    -->
    {#if local?.upstream}
      {@const up = local.upstream}
      {@const hint = gapHint(up)}
      {#if up.ahead > 0}
        <span class="gap ahead" title={hint}>↑{up.ahead}</span>
      {/if}
      {#if up.behind > 0}
        <span class="gap behind" title={hint}>↓{up.behind}</span>
      {/if}
    {/if}
  </div>
{:else}
  {@const open = repo.isBranchDirOpen(node.path)}
  <button
    class="dir"
    style="padding-left: {depth * 12 + 8}px"
    onclick={() => repo.toggleBranchDir(node.path)}
    aria-expanded={open}
  >
    <span class="chev" class:open>▶</span>
    <svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
      <path d="M1.75 4.25a1 1 0 0 1 1-1h3.1l1.5 1.6h6.9a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z" />
    </svg>
    <span class="dname">{node.name}</span>
  </button>
  {#if open}
    {#each node.children as child (child.type === "dir" ? "d:" + child.path : "b:" + child.branch.name)}
      <BranchRow node={child} depth={depth + 1} />
    {/each}
  {/if}
{/if}

<style>
  .branch,
  .dir {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    background: transparent;
    border: none;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.82rem;
    text-align: left;
    color: var(--text);
  }
  .branch:hover,
  .dir:hover {
    background: var(--bg-raised);
  }
  /* Branche courante : fond vert + coche, comme la référence. */
  .branch.current {
    background: rgba(74, 222, 128, 0.16);
    color: #86efac;
    font-weight: 600;
  }
  .branch.current:hover {
    background: rgba(74, 222, 128, 0.22);
  }
  /* Branche dont la tête est le commit affiché à droite. */
  .branch.selected {
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .mark {
    flex: none;
    width: 0.8rem;
    font-size: 0.7rem;
    color: #4ade80;
  }
  .ic {
    flex: none;
    width: 13px;
    height: 13px;
    color: var(--text-faint);
  }
  .branch.current .ic {
    color: #4ade80;
  }
  /* Écart avec l'amont : à pousser en accent, à récupérer en atténué. Les
     chiffres sont tabulaires pour que les pastilles ne dansent pas d'une ligne
     à l'autre. */
  .gap {
    flex: none;
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
  }
  .gap.ahead {
    color: var(--accent-soft);
  }
  .gap.behind {
    color: var(--text-faint);
  }
  .bname,
  .dname {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dir {
    color: var(--text-dim);
  }
  .chev {
    flex: none;
    display: inline-block;
    width: 0.7rem;
    font-size: 0.55rem;
    color: var(--text-faint);
    transition: transform 0.1s ease;
  }
  .chev.open {
    transform: rotate(90deg);
  }
</style>

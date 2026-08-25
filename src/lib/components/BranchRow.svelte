<script lang="ts">
  import type { BranchTreeNode } from "../tree";
  import { repo } from "../stores/repo.svelte";
  import BranchRow from "./BranchRow.svelte"; // récursion (auto-import Svelte 5)

  let { node, depth = 0 }: { node: BranchTreeNode; depth?: number } = $props();

  function checkout(name: string) {
    repo.checkoutBranch(name);
  }

  /** Clic simple : sélectionne la tête de la branche dans le graph. */
  function selectTip(oid: string) {
    if (oid) repo.selectCommit(oid);
  }
</script>

{#if node.type === "branch"}
  {@const current = node.branch.isHead}
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
    title="{node.branch.name} — clic pour voir son dernier commit, double-clic pour basculer"
    onclick={() => selectTip(node.branch.oid)}
    ondblclick={() => checkout(node.branch.name)}
    onkeydown={(e) => (e.key === "Enter" ? checkout(node.branch.name) : undefined)}
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

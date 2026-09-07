<script lang="ts">
  import type { TreeNode } from "../tree";
  import { repo } from "../stores/repo.svelte";
  import FileItem from "./FileItem.svelte";
  import TreeRow from "./TreeRow.svelte"; // récursion (auto-import Svelte 5)
  import Chevron from "./Chevron.svelte";

  let {
    node,
    staged,
    depth = 0,
  }: { node: TreeNode; staged: boolean; depth?: number } = $props();
</script>

{#if node.type === "file"}
  <FileItem entry={node.entry} {staged} label={node.name} {depth} />
{:else}
  {@const open = repo.isDirOpen(node.path)}
  <button
    class="dir"
    style="padding-left: calc(var(--row-inset) + {depth * 12}px)"
    onclick={() => repo.toggleDir(node.path)}
    aria-expanded={open}
  >
    <Chevron {open} />
    <span class="dname">{node.name}</span>
    <span class="counts">
      {#if node.counts.modified}<span class="c mod">✎ {node.counts.modified}</span>{/if}
      {#if node.counts.added}<span class="c add">+ {node.counts.added}</span>{/if}
      {#if node.counts.deleted}<span class="c del">− {node.counts.deleted}</span>{/if}
    </span>
  </button>
  {#if open}
    {#each node.children as child (child.type === "dir" ? "d:" + child.path : "f:" + child.entry.path)}
      <TreeRow node={child} {staged} depth={depth + 1} />
    {/each}
  {/if}
{/if}

<style>
  .dir {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    background: transparent;
    border: none;
    color: var(--text-dim);
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.82rem;
    text-align: left;
  }
  .dir:hover {
    background: var(--bg-raised);
  }
  .dname {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }
  .counts {
    flex: none;
    display: flex;
    gap: 0.4rem;
    font-size: 0.72rem;
  }
  .c.mod { color: var(--warn); }
  .c.add { color: var(--ok); }
  .c.del { color: var(--danger); }
</style>

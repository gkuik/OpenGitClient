<script lang="ts">
  import type { FileEntry } from "../types";
  import { repo } from "../stores/repo.svelte";
  import { buildTree } from "../tree";
  import FileItem from "./FileItem.svelte";
  import TreeRow from "./TreeRow.svelte";

  let { entries, staged }: { entries: FileEntry[]; staged: boolean } = $props();

  // Vue Tree : arborescence de dossiers ; vue Path : liste plate (chemins complets).
  const nodes = $derived(
    repo.viewMode === "tree" ? buildTree(entries, repo.sortAsc) : [],
  );
</script>

{#if entries.length === 0}
  <p class="empty">—</p>
{:else if repo.viewMode === "tree"}
  {#each nodes as node (node.type === "dir" ? "d:" + node.path : "f:" + node.entry.path)}
    <TreeRow {node} {staged} />
  {/each}
{:else}
  {#each entries as entry (entry.path)}
    <FileItem {entry} {staged} label={entry.path} />
  {/each}
{/if}

<style>
  .empty {
    color: var(--text-dim);
    font-size: 0.8rem;
    padding: 0.15rem 0.5rem;
    opacity: 0.6;
  }
</style>

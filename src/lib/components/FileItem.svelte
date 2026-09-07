<script lang="ts">
  import type { FileEntry } from "../types";
  import { repo } from "../stores/repo.svelte";
  import { STATUS_BADGES } from "../badges";

  let {
    entry,
    staged,
    label = entry.path,
    depth = 0,
  }: { entry: FileEntry; staged: boolean; label?: string; depth?: number } = $props();

  const badge = $derived(STATUS_BADGES[entry.status]);
  const selected = $derived(
    repo.selectedPath === entry.path && repo.selectedStaged === staged,
  );

  function toggleStage(e: MouseEvent) {
    // Empêche la sélection (clic sur la ligne) de se déclencher aussi.
    e.stopPropagation();
    if (staged) repo.unstage(entry.path);
    else repo.stage(entry.path);
  }

  function selectFile() {
    repo.select(entry.path, staged);
  }
</script>

<div
  class="row"
  class:selected
  role="button"
  tabindex="0"
  style="padding-left: calc(var(--row-inset) + {depth * 12}px)"
  onclick={selectFile}
  onkeydown={(e) => (e.key === "Enter" ? selectFile() : undefined)}
>
  <span class="badge {badge.cls}">{badge.label}</span>
  <span
    class="path"
    title={entry.oldPath ? `${entry.oldPath} → ${entry.path}` : entry.path}
  >
    {label}
  </span>
  <button
    class="action"
    onclick={toggleStage}
    disabled={repo.busy}
    title={staged ? "Retirer de l'index" : "Indexer"}
    aria-label={staged ? "Retirer de l'index" : "Indexer"}
  >
    {staged ? "−" : "+"}
  </button>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.82rem;
  }
  .row:hover {
    background: var(--bg-raised);
  }
  .row.selected {
    background: var(--accent-bg);
  }
  .badge {
    flex: none;
    width: 1.1rem;
    text-align: center;
    font-weight: 700;
    font-size: 0.72rem;
    border-radius: 3px;
  }
  .badge.mod { color: var(--warn); }
  .badge.add { color: var(--ok); }
  .badge.del { color: var(--danger); }
  .badge.ren { color: var(--info); }
  .badge.unt { color: var(--neutral); }
  .path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .action {
    flex: none;
    width: 1.4rem;
    height: 1.4rem;
    border: 1px solid var(--border);
    background: var(--bg-raised);
    color: var(--text);
    border-radius: 4px;
    cursor: pointer;
    line-height: 1;
    font-size: 0.9rem;
  }
  .action:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .action:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>

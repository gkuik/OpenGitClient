<script lang="ts">
  import { repo } from "../stores/repo.svelte";

  function sign(kind: string): string {
    if (kind === "addition") return "+";
    if (kind === "deletion") return "-";
    return " ";
  }

  // D'où vient le diff affiché : working directory (indexé ou non) ou commit.
  const tag = $derived.by(() => {
    const t = repo.diffTarget;
    if (t?.kind === "commit") return `commit ${t.oid.slice(0, 7)}`;
    return repo.selectedStaged ? "indexé" : "modifié";
  });
</script>

<div class="diff">
  {#if !repo.selectedPath}
    <p class="placeholder">Sélectionne un fichier pour afficher son diff.</p>
  {:else}
    <!--
      L'en-tête (et donc la croix de fermeture) est affiché dès qu'un fichier est
      sélectionné, y compris pour un binaire ou un diff vide — sinon ces états
      seraient impossibles à fermer.
    -->
    <div class="file-head">
      <span class="fname">{repo.selectedPath}</span>
      <span class="tag">{tag}</span>
      <button
        class="close"
        onclick={() => repo.clearSelection()}
        title="Fermer la visualisation"
        aria-label="Fermer la visualisation"
      >
        ×
      </button>
    </div>

    {#if !repo.diff}
      <p class="placeholder">Chargement du diff…</p>
    {:else if repo.diff.isBinary}
      <p class="placeholder">Fichier binaire — diff non affichable.</p>
    {:else if repo.diff.hunks.length === 0}
      <p class="placeholder">Aucune différence à afficher.</p>
    {:else}
      <div class="code">
        {#each repo.diff.hunks as hunk, hi (hi)}
          <div class="line hunk">{hunk.header}</div>
          {#each hunk.lines as line, li (hi + "-" + li)}
            <div class="line {line.kind}">
              <span class="gutter">{line.oldLineno ?? ""}</span>
              <span class="gutter">{line.newLineno ?? ""}</span>
              <span class="sign">{sign(line.kind)}</span>
              <span class="content">{line.content}</span>
            </div>
          {/each}
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .diff {
    height: 100%;
    overflow: auto;
    display: flex;
    flex-direction: column;
  }
  .placeholder {
    margin: auto;
    color: var(--text-dim);
    font-size: 0.9rem;
  }
  .file-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.8rem;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 1;
  }
  .fname {
    font-family: var(--mono);
    font-size: 0.82rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    flex: none;
    font-size: 0.7rem;
    color: var(--accent-soft);
    background: var(--bg-raised);
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
  }
  .close {
    /* Poussée à droite de l'en-tête. */
    margin-left: auto;
    flex: none;
    width: 1.5rem;
    height: 1.5rem;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-dim);
    border-radius: 4px;
    cursor: pointer;
    line-height: 1;
    font-size: 1rem;
  }
  .close:hover {
    border-color: var(--accent);
    color: var(--text);
  }
  .code {
    font-family: var(--mono);
    font-size: 0.8rem;
    line-height: 1.5;
  }
  .line {
    display: flex;
    white-space: pre;
    padding-right: 0.8rem;
  }
  .gutter {
    flex: none;
    width: 3rem;
    text-align: right;
    padding-right: 0.6rem;
    color: var(--text-faint);
    user-select: none;
  }
  .sign {
    flex: none;
    width: 1rem;
    text-align: center;
    user-select: none;
  }
  .content {
    flex: 1;
  }
  .line.hunk {
    color: var(--accent-soft);
    background: var(--bg-raised);
    padding: 0.15rem 0.8rem;
  }
  .line.addition {
    background: var(--diff-add-bg);
    color: var(--ok-soft);
  }
  .line.deletion {
    background: var(--diff-del-bg);
    color: var(--danger-soft);
  }
</style>

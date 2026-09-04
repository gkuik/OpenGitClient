<script lang="ts">
  import { repo } from "../stores/repo.svelte";
  import { STATUS_BADGES } from "../badges";
  import CommitBody from "./CommitBody.svelte";

  // Occupe la colonne de droite à la place des changements en cours tant qu'un
  // commit est sélectionné. Sa liste de fichiers reste visible pendant
  // l'affichage d'un diff : c'est elle qui sert à passer d'un fichier à l'autre.
  const details = $derived(repo.commitDetails);

  const dateFmt = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  /** Le fichier ouvert au centre, s'il provient de ce commit. */
  function isOpen(path: string): boolean {
    const t = repo.diffTarget;
    return t?.kind === "commit" && t.path === path;
  }

  function openFile(path: string) {
    const oid = repo.commitDetails?.oid;
    if (oid) repo.selectCommitFile(oid, path);
  }
</script>

<div class="panel">
  <div class="sb-head">
    <span class="label">Commit</span>
    <span class="oid">{details?.shortOid ?? "…"}</span>
    <button
      class="close"
      onclick={() => repo.clearCommitSelection()}
      title="Fermer le commit"
      aria-label="Fermer le commit"
    >
      ×
    </button>
  </div>

  {#if !details}
    <p class="placeholder">Chargement du commit…</p>
  {:else}
    <!-- Ordre : titre · commentaire · auteur · nombre de fichiers · liste. -->
    <div class="content">
      <h2 class="title">{details.summary}</h2>

      {#if details.body}
        <div class="body">
          <CommitBody text={details.body} />
        </div>
      {/if}

      <div class="author">
        <span class="name">{details.authorName}</span>
        <span class="dim">{dateFmt.format(new Date(details.timestamp * 1000))}</span>
        {#if details.parents.length > 1}
          <span class="merge">merge</span>
        {/if}
      </div>

      <div class="files-head">
        {details.files.length}
        {details.files.length > 1 ? "fichiers modifiés" : "fichier modifié"}
        {#if details.parents.length > 1}
          <span class="dim">(vs premier parent)</span>
        {/if}
      </div>

      <div class="files">
        {#each details.files as f (f.path)}
          <div
            class="file"
            class:selected={isOpen(f.path)}
            role="button"
            tabindex="0"
            onclick={() => openFile(f.path)}
            onkeydown={(e) => (e.key === "Enter" ? openFile(f.path) : undefined)}
          >
            <span class="badge {STATUS_BADGES[f.status].cls}">
              {STATUS_BADGES[f.status].label}
            </span>
            <span class="path" title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>
              {f.path}
            </span>
          </div>
        {:else}
          <p class="placeholder small">Aucun fichier modifié.</p>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  /* Même gabarit d'en-tête que le panneau de statut qu'il remplace. */
  .sb-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: none;
    padding: 0.5rem 0.7rem;
    border-bottom: 1px solid var(--border);
  }
  .oid {
    flex: none;
    font-family: var(--mono);
    font-size: 0.75rem;
    color: var(--accent-soft);
    background: var(--bg-raised);
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
  }
  .label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }
  .close {
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

  .content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.5rem 0.7rem 0.7rem;
  }
  .placeholder {
    margin: 0;
    padding: 0.8rem 0.7rem;
    color: var(--text-dim);
    font-size: 0.85rem;
  }
  .placeholder.small {
    padding: 0.3rem 0.1rem;
    font-size: 0.8rem;
    opacity: 0.7;
  }
  /* Point d'entrée visuel du panneau : nettement au-dessus du reste. */
  .title {
    margin: 0.1rem 0 0;
    font-size: 1rem;
    font-weight: 700;
    line-height: 1.3;
    color: var(--text);
    word-break: break-word;
  }
  .author {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.55rem;
    font-size: 0.75rem;
  }
  .name {
    color: var(--text-dim);
  }
  .dim {
    color: var(--text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .merge {
    flex: none;
    font-size: 0.68rem;
    color: var(--warn);
    border: 1px solid var(--warn-border);
    padding: 0.05rem 0.3rem;
    border-radius: 4px;
  }
  .body {
    margin-top: 0.45rem;
  }
  .files-head {
    margin: 0.7rem 0 0.4rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }
  /* Séparateur entre le décompte et la liste elle-même. */
  .files {
    border-top: 1px solid var(--border);
    padding-top: 0.35rem;
  }
  .file {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.4rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8rem;
  }
  .file:hover {
    background: var(--bg-raised);
  }
  .file.selected {
    background: var(--accent-bg);
  }
  .badge {
    flex: none;
    width: 1.1rem;
    text-align: center;
    font-weight: 700;
    font-size: 0.72rem;
  }
  /* Même code couleur que la liste des fichiers modifiés (voir badges.ts). */
  .badge.mod { color: var(--warn); }
  .badge.add { color: var(--ok); }
  .badge.del { color: var(--danger); }
  .badge.ren { color: var(--info); }
  .badge.unt { color: var(--neutral); }
  .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    /*
      Jamais de `direction: rtl` ici pour une ellipse à gauche : cela réordonne
      le texte bidi et casse les fichiers cachés (cf. FileItem.svelte).
    */
  }
</style>

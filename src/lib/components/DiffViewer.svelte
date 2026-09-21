<script lang="ts">
  import { t } from "../i18n.svelte";
  import Cross from "./Cross.svelte";
  import CommitBody from "./CommitBody.svelte";
  import { repo } from "../stores/repo.svelte";

  function sign(kind: string): string {
    if (kind === "addition") return "+";
    if (kind === "deletion") return "-";
    return " ";
  }

  // D'où vient le diff affiché : working directory (indexé ou non) ou commit.
  // Un fichier non suivi n'est pas « modifié » : il est neuf, et le diff est
  // alors tout son contenu.
  const tag = $derived.by(() => {
    const target = repo.diffTarget;
    if (target?.kind === "commit")
      return t("diff.tag.commit", { oid: target.oid.slice(0, 7) });
    if (repo.selectedStaged) return t("diff.tag.staged");
    const untracked = repo.status?.untracked.some((f) => f.path === repo.selectedPath) ?? false;
    return untracked ? t("diff.tag.untracked") : t("diff.tag.modified");
  });
</script>

<div class="diff">
  {#if !repo.selectedPath}
    <p class="placeholder">{t("diff.pick")}</p>
  {:else}
    <!--
      L'en-tête (et donc la croix de fermeture) est affiché dès qu'un fichier est
      sélectionné, y compris pour un binaire ou un diff vide — sinon ces états
      seraient impossibles à fermer.
    -->
    <div class="file-head">
      <span class="fname">{repo.selectedPath}</span>
      <span class="tag">{tag}</span>
      <!-- Un Markdown se lit aussi rendu : la bascule n'apparaît que là, un
           autre fichier n'ayant que son code à montrer. Le rendu passe par
           `CommitBody`, le même Markdown sans `{@html}` que les descriptions de
           commit — un README vient de l'extérieur autant qu'un message. -->
      {#if repo.selectedIsMarkdown}
        <div class="seg" role="group" aria-label={t("diff.view.preview")}>
          <button
            class:active={!repo.showPreview}
            title={t("diff.view.code.hint")}
            onclick={() => repo.setRenderMarkdown(false)}
          >
            {t("diff.view.code")}
          </button>
          <button
            class:active={repo.showPreview}
            title={t("diff.view.preview.hint")}
            onclick={() => repo.setRenderMarkdown(true)}
          >
            {t("diff.view.preview")}
          </button>
        </div>
      {/if}
      <button
        class="close"
        onclick={() => repo.clearSelection()}
        title={t("diff.close")}
        aria-label={t("diff.close")}
      >
        <Cross />
      </button>
    </div>

    {#if repo.showPreview}
      {#if !repo.preview}
        <p class="placeholder">{t("diff.preview.loading")}</p>
      {:else if repo.preview.text === null}
        <p class="placeholder">
          {repo.preview.binary ? t("diff.preview.binary") : t("diff.preview.unavailable")}
        </p>
      {:else}
        <div class="preview">
          <CommitBody text={repo.preview.text} />
        </div>
      {/if}
    {:else if !repo.diff}
      <p class="placeholder">{t("diff.loading")}</p>
    {:else if repo.diff.isBinary}
      <p class="placeholder">{t("diff.binary")}</p>
    {:else if repo.diff.hunks.length === 0}
      <p class="placeholder">{t("diff.empty")}</p>
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
  /* Bascule Code | Preview : le gabarit segmenté de Path | Tree, dans la
     colonne de droite. Poussée contre la croix, à droite de l'en-tête. */
  .seg {
    flex: none;
    margin-left: auto;
    display: flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .seg button {
    background: var(--bg-raised);
    border: none;
    color: var(--text-dim);
    font-size: 0.75rem;
    padding: 0.25rem 0.6rem;
    cursor: pointer;
  }
  .seg button.active {
    background: var(--accent);
    color: var(--accent-text);
  }
  /* Le rendu est de la prose : une colonne de lecture, sélectionnable, et un
     corps de texte à la taille du reste de l'interface plutôt qu'à celle,
     réduite, d'une description de commit dans sa colonne. */
  .preview {
    max-width: 52rem;
    padding: 1rem 1.4rem 2rem;
    user-select: text;
    -webkit-user-select: text;
  }
  .preview :global(.md) {
    font-size: 0.86rem;
    line-height: 1.55;
    color: var(--text);
  }
  .preview :global(.md .h1) {
    font-size: 1.3rem;
  }
  .preview :global(.md .h2) {
    font-size: 1.1rem;
  }
  .preview :global(.md .h3) {
    font-size: 0.95rem;
  }
  .close {
    /* Poussée à droite de l'en-tête. Quand la bascule est là, c'est elle qui
       porte la marge, et la croix reste collée à elle. */
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
    /* La croix est un tracé (`Cross`) : le bouton n'a plus qu'à centrer sa boîte,
       et son remplissage par défaut — l'une des causes du décalage — est ôté. */
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  /* Deux marges automatiques se partageraient l'espace et laisseraient la
     bascule au milieu de l'en-tête : à côté de la bascule, la croix n'en a pas. */
  .seg + .close {
    margin-left: 0;
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

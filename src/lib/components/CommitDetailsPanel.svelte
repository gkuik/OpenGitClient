<script lang="ts">
  import { i18n, t } from "../i18n.svelte";
  import { repo } from "../stores/repo.svelte";
  import { STATUS_BADGES } from "../badges";
  import CommitBody from "./CommitBody.svelte";
  import SectionHeader from "./SectionHeader.svelte";

  // Occupe la colonne de droite à la place des changements en cours tant qu'un
  // commit est sélectionné. Sa liste de fichiers reste visible pendant
  // l'affichage d'un diff : c'est elle qui sert à passer d'un fichier à l'autre.
  const details = $derived(repo.commitDetails);

  // Dérivé, et non figé au montage : la langue décide du format, et le panneau
  // est monté une fois pour tous les onglets.
  const dateFmt = $derived(
    new Intl.DateTimeFormat(i18n.locale, { dateStyle: "medium", timeStyle: "short" }),
  );

  /** Le fichier ouvert au centre, s'il provient de ce commit. */
  function isOpen(path: string): boolean {
    const t = repo.diffTarget;
    return t?.kind === "commit" && t.path === path;
  }

  function openFile(path: string) {
    const oid = repo.commitDetails?.oid;
    if (oid) repo.selectCommitFile(oid, path);
  }

  // La liste se replie comme n'importe quelle section des deux colonnes ; l'état
  // est local, comme celui des sections voisines.
  let filesOpen = $state(true);
</script>

<div class="panel">
  <div class="sb-head">
    <span class="label">{t("commitDetails.label")}</span>
    <span class="oid">{details?.shortOid ?? "…"}</span>
    <button
      class="close"
      onclick={() => repo.clearCommitSelection()}
      title={t("commitDetails.close")}
      aria-label={t("commitDetails.close")}
    >
      ×
    </button>
  </div>

  {#if !details}
    <p class="placeholder">{t("commitDetails.loading")}</p>
  {:else}
    <!-- Ordre : titre · commentaire · auteur, puis la liste des fichiers, qui est
         une section comme celles des deux colonnes. -->
    <div class="meta">
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
    </div>

    <section class:collapsed={!filesOpen}>
      <SectionHeader
        label={t("commitDetails.files")}
        icon={fileIcon}
        count={details.files.length}
        open={filesOpen}
        onToggle={() => (filesOpen = !filesOpen)}
        actions={details.parents.length > 1 ? parentHint : undefined}
      />
      {#if filesOpen}
        <div class="sec-body">
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
            <p class="placeholder small">{t("commitDetails.noFile")}</p>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</div>

<!-- Feuille : le fichier touché par le commit. -->
{#snippet fileIcon()}
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
    <path d="M9 1.8H4.5a1 1 0 0 0-1 1v10.4a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5.3z" />
    <path d="M9 1.8V5.3h3.5" />
  </svg>
{/snippet}

<!-- Un commit de fusion n'est comparé qu'à son premier parent : le dire ici
     évite de laisser croire que la liste couvre les deux côtés. -->
{#snippet parentHint()}
  <span class="hint">{t("commitDetails.firstParent")}</span>
{/snippet}

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

  /* Le bloc d'identité défile chez lui : l'en-tête de la liste des fichiers ne
     s'en va donc plus avec un long message de commit. Les deux blocs se
     rétrécissent proportionnellement quand la place manque, si bien que la
     liste garde toujours une part visible. */
  .meta {
    flex: 0 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 0.5rem 0.7rem 0.7rem;
  }
  /* La liste des fichiers se clique, elle ne se cite pas — contrairement au
     bloc `.meta` juste au-dessus, dont le titre et la description du commit
     restent sélectionnables : c'est le seul texte de la colonne qu'on copie. */
  section {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    user-select: none;
    -webkit-user-select: none;
  }
  /* Repliée : rien que son en-tête. */
  section.collapsed {
    flex: none;
  }
  /* En-tête et trait de séparation : voir `SectionHeader`. */
  .sec-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.3rem var(--sec-inset) 0.6rem;
  }
  .hint {
    font-size: 0.7rem;
    color: var(--text-faint);
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
  .file {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.4rem 0.25rem var(--row-inset);
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

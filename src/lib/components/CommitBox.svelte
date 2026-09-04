<script lang="ts">
  import { repo, tabs } from "../stores/repo.svelte";

  /**
   * Valeur du sélecteur pour « identité propre au dépôt, ne correspondant à aucun
   * profil ». Elle doit exister comme option, sinon le `<select>` afficherait le
   * premier profil venu et laisserait croire qu'il est actif.
   */
  const UNMATCHED = "__local";
  /** Raccourci vers l'écran Paramètres, dernière entrée de la liste. */
  const MANAGE = "__manage";

  const active = $derived(repo.activeProfile(tabs.profiles));
  const identity = $derived(repo.identity);
  const unmatched = $derived(identity?.isLocal === true && active === null);
  const selected = $derived(active ? active.id : unmatched ? UNMATCHED : "");

  /** Identité effective, telle qu'elle sera signée. */
  const who = $derived(identity?.name ?? identity?.email ?? null);
  const fullWho = $derived(
    identity?.name || identity?.email
      ? `${identity.name ?? "—"} <${identity.email ?? "—"}>`
      : "Aucune identité Git configurée",
  );

  /** Suffixe « · Nom » ajouté à une option, quand ce nom est connu. */
  function withWho(label: string, name: string | null): string {
    return name ? `${label} · ${name}` : label;
  }

  function pick(event: Event & { currentTarget: HTMLSelectElement }) {
    const id = event.currentTarget.value;
    if (id === UNMATCHED) return; // pseudo-option, seulement descriptive
    if (id === MANAGE) {
      // Rien n'a changé côté dépôt : le sélecteur doit retrouver sa valeur, que
      // l'état dérivé ne réécrira pas puisqu'il n'a pas bougé.
      event.currentTarget.value = selected;
      tabs.settingsOpen = true;
      return;
    }
    repo.applyProfile(tabs.profiles.find((p) => p.id === id) ?? null);
  }

  /*
    Onglet affiché. Local au composant, contrairement aux brouillons : ce n'est
    pas un état du dépôt mais une façon de regarder la colonne, et rien d'autre
    ne l'édite. Il reste donc le même d'un onglet de dépôt à l'autre — les
    champs, eux, changent avec le dépôt.
  */
  let pane = $state<"commit" | "stash">("commit");

  const SUMMARY_TARGET = 72; // longueur de titre recommandée (convention Git)

  /*
    Le brouillon vit dans l'onglet, pas ici : cette boîte n'est montée qu'une
    fois pour tous les onglets, et la rangée « modifications en cours » du graph
    édite le même résumé. Deux champs, une seule valeur.
  */
  const summary = $derived(repo.commitSummary);

  const canCommit = $derived(
    summary.trim().length > 0 && !repo.committing && repo.hasStaged,
  );

  const buttonLabel = $derived(repo.committing ? "En cours…" : "Committer");

  async function doCommit() {
    if (!canCommit) return;
    // Le store committe son propre brouillon et le vide s'il y parvient.
    await repo.commit();
  }

  /*
    Brouillon de remise, distinct de celui du commit (voir `RepoStore`). Une
    remise n'a pas besoin d'index : elle range tout ce qui traîne, fichiers non
    suivis compris — d'où une garde sur le nombre de changements et non sur
    `hasStaged`.
  */
  const stashSummary = $derived(repo.stashSummary);

  const canStash = $derived(
    stashSummary.trim().length > 0 && !repo.stashing && repo.changeCount > 0,
  );

  const stashLabel = $derived(repo.stashing ? "En cours…" : "Remiser");

  async function doStash() {
    if (!canStash) return;
    await repo.stash();
  }
</script>

<div class="commit">
  <!-- Deux onglets sur toute la largeur de la colonne : ce qu'on écrit part
       soit dans un commit, soit dans une remise. -->
  <div class="tabs">
    <button class="tab" class:active={pane === "commit"} onclick={() => (pane = "commit")}>
      Commit
    </button>
    <button class="tab" class:active={pane === "stash"} onclick={() => (pane = "stash")}>
      Remiser
    </button>
  </div>

  {#if pane === "commit"}
    <!-- Sous qui l'on committe : au-dessus du message, puisque c'est ce que le
         commit portera. Écrit dans la config Git du dépôt, pas mémorisé ici.
         L'identité effective est portée par les libellés plutôt que par une
         ligne à côté : un seul contrôle, sur toute la largeur de la colonne.
         Absent du volet Remiser : une remise n'est pas signée d'un auteur
         qu'on choisit, elle range du travail en cours. -->
    <select
      class="author"
      aria-label="Profil d'auteur"
      title={fullWho}
      value={selected}
      disabled={!repo.repoInfo}
      onchange={pick}
    >
      <option value="">{withWho("Config globale", active || unmatched ? null : who)}</option>
      {#each tabs.profiles as profile (profile.id)}
        <option value={profile.id}>{withWho(profile.label, profile.name)}</option>
      {/each}
      {#if unmatched}
        <option value={UNMATCHED}>{withWho("Identité du dépôt", who)}</option>
      {/if}
      <option value={MANAGE}>Gérer les profils…</option>
    </select>

    <div class="field">
      <input
        class="summary"
        placeholder="Résumé du commit"
        bind:value={repo.commitSummary}
        disabled={!repo.repoInfo}
      />
      <span class="counter" class:over={summary.length > SUMMARY_TARGET}>
        {summary.length}/{SUMMARY_TARGET}
      </span>
    </div>

    <textarea
      class="body"
      placeholder="Description (optionnelle)"
      rows="3"
      bind:value={repo.commitBody}
      disabled={!repo.repoInfo}
    ></textarea>

    {#if repo.repoInfo && !repo.hasStaged}
      <p class="hint">Indexez des fichiers pour pouvoir committer.</p>
    {/if}

    <button class="action" onclick={doCommit} disabled={!canCommit}>
      -o- {buttonLabel}
    </button>
  {:else}
    <input
      class="summary lone"
      placeholder="Nom de la remise"
      bind:value={repo.stashSummary}
      disabled={!repo.repoInfo}
    />

    <textarea
      class="body"
      placeholder="Description (optionnelle)"
      rows="3"
      bind:value={repo.stashBody}
      disabled={!repo.repoInfo}
    ></textarea>

    {#if repo.repoInfo && repo.changeCount === 0}
      <p class="hint">Aucune modification à remiser.</p>
    {/if}

    <button class="action" onclick={doStash} disabled={!canStash}>
      {stashLabel}
    </button>
  {/if}
</div>

<style>
  .commit {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.6rem;
    border-top: 1px solid var(--border);
    background: var(--bg);
  }
  /*
    Barre d'onglets : les deux se partagent la largeur de la colonne à parts
    égales, et le soulignement accent marque celui qui est actif. La bordure du
    bas est portée par les deux boutons, transparente sur l'inactif, pour que
    passer de l'un à l'autre ne décale pas le contenu d'un pixel.
  */
  .tabs {
    display: flex;
  }
  .tab {
    flex: 1;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 0 0 0.3rem;
    font-size: 0.8rem;
    font-family: inherit;
    font-weight: 600;
    color: var(--text-faint);
    cursor: pointer;
  }
  .tab:hover {
    color: var(--text-dim);
  }
  .tab.active {
    color: var(--text-dim);
    border-bottom-color: var(--accent);
  }
  /*
    Un seul contrôle, sur toute la largeur de la colonne, calé sur le champ
    « Résumé du commit » : mêmes fond, bordure, rayon, taille de police et
    remplissage vertical, donc même hauteur.

    `appearance: none` est ce qui rend l'alignement possible : un `<select>`
    natif impose sa propre hauteur et son bouton bleu, insensibles au
    remplissage. Le chevron est donc redessiné en fond, et le remplissage à
    droite lui réserve sa place.
  */
  .author {
    width: 100%;
    padding: 0.45rem 1.9rem 0.45rem 0.6rem;
    background-color: var(--bg-raised);
    background-image: var(--select-chevron);
    background-repeat: no-repeat;
    background-position: right 0.6rem center;
    background-size: 10px 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.82rem;
    font-family: inherit;
    box-sizing: border-box;
    appearance: none;
    -webkit-appearance: none;
  }
  .author:focus {
    outline: none;
    border-color: var(--accent);
  }
  .author:disabled {
    opacity: 0.5;
  }
  .field {
    position: relative;
  }
  .summary {
    width: 100%;
    padding-right: 3.2rem; /* place réservée au compteur */
  }
  /* Pas de compteur côté remise : le nom d'un stash ne suit aucune convention
     de longueur, et le creux à droite se verrait. */
  .summary.lone {
    padding-right: 0.6rem;
  }
  .counter {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    font-size: 0.7rem;
    color: var(--text-faint);
    pointer-events: none;
  }
  .counter.over {
    color: var(--warn);
  }
  .summary,
  .body {
    background: var(--bg-raised);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 0.45rem 0.6rem;
    font-size: 0.82rem;
    font-family: inherit;
    resize: vertical;
    box-sizing: border-box;
  }
  .body {
    width: 100%;
  }
  .summary:focus,
  .body:focus {
    outline: none;
    border-color: var(--accent);
  }
  .summary:disabled,
  .body:disabled {
    opacity: 0.5;
  }
  .hint {
    margin: 0;
    font-size: 0.72rem;
    color: var(--text-faint);
  }
  .action {
    background: var(--accent);
    color: var(--accent-text);
    border: none;
    padding: 0.55rem;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .action:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>

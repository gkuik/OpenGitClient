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

  let summary = $state("");
  let body = $state("");

  const SUMMARY_TARGET = 72; // longueur de titre recommandée (convention Git)

  const canCommit = $derived(
    summary.trim().length > 0 && !repo.committing && repo.hasStaged,
  );

  const buttonLabel = $derived(repo.committing ? "En cours…" : "Committer");

  async function doCommit() {
    if (!canCommit) return;
    // L'amend existe côté backend mais n'est plus exposé ici.
    const ok = await repo.commit(summary, body.length > 0 ? body : null);
    if (ok) {
      summary = "";
      body = "";
    }
  }
</script>

<div class="commit">
  <div class="tab">-o- Commit</div>

  <!-- Sous qui l'on commite : au-dessus du message, puisque c'est ce que le
       commit portera. Écrit dans la config Git du dépôt, pas mémorisé ici.
       L'identité effective est portée par les libellés plutôt que par une ligne
       à côté : un seul contrôle, sur toute la largeur de la colonne. -->
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
      bind:value={summary}
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
    bind:value={body}
    disabled={!repo.repoInfo}
  ></textarea>

  {#if repo.repoInfo && !repo.hasStaged}
    <p class="hint">Indexez des fichiers pour pouvoir committer.</p>
  {/if}

  <button class="commit-btn" onclick={doCommit} disabled={!canCommit}>
    -o- {buttonLabel}
  </button>
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
  .tab {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-dim);
    border-bottom: 2px solid var(--accent);
    display: inline-block;
    padding-bottom: 0.3rem;
    width: fit-content;
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
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%239ca3af' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
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
    padding-right: 3.2rem;
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
    color: #fbbf24;
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
  .commit-btn {
    background: var(--accent);
    color: #fff;
    border: none;
    padding: 0.55rem;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .commit-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>

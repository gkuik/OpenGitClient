<script lang="ts">
  import { repo } from "../stores/repo.svelte";

  let summary = $state("");
  let body = $state("");
  let amend = $state(false);

  const SUMMARY_TARGET = 72; // longueur de titre recommandée (convention Git)

  // En amend, l'index peut être vide (on ne change que le message) ; sinon il
  // faut au moins un fichier indexé.
  const canCommit = $derived(
    summary.trim().length > 0 && !repo.committing && (amend || repo.hasStaged),
  );

  const buttonLabel = $derived(
    repo.committing ? "En cours…" : amend ? "Amender le commit" : "Committer",
  );

  async function doCommit() {
    if (!canCommit) return;
    const ok = await repo.commit(summary, body.length > 0 ? body : null, amend);
    if (ok) {
      summary = "";
      body = "";
      amend = false;
    }
  }
</script>

<div class="commit">
  <div class="tab">-o- Commit</div>

  <label class="amend">
    <input type="checkbox" bind:checked={amend} disabled={!repo.repoInfo} />
    Amender le commit précédent
  </label>

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

  {#if repo.repoInfo && !repo.hasStaged && !amend}
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
  .amend {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.78rem;
    color: var(--text-dim);
    cursor: pointer;
  }
  .amend input {
    accent-color: var(--accent);
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

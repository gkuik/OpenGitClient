<script lang="ts">
  import { t } from "../i18n.svelte";
  import { repo } from "../stores/repo.svelte";

  // Même contrat que le dialogue d'identifiants : monté en permanence, il ne
  // rend rien sans demande, et relit l'onglet actif à chaque rendu — changer
  // d'onglet change de demande.
  const prompt = $derived(repo.tagPrompt);

  let name = $state("");
  let message = $state("");

  // Formulaire vide à chaque nouveau commit visé : un nom saisi pour l'un n'a
  // rien à faire sur l'autre.
  let lastOid = $state<string | null>(null);
  $effect(() => {
    const oid = prompt?.oid ?? null;
    if (oid !== lastOid) {
      lastOid = oid;
      name = "";
      message = "";
    }
  });

  const canSubmit = $derived(name.trim().length > 0 && !repo.creatingTag);

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    // En cas d'échec (nom déjà pris, nom invalide), le dialogue reste ouvert et
    // le bandeau dit pourquoi : la saisie se corrige sur place.
    void repo.createTag(name, message);
  }
</script>

<svelte:window onkeydown={(e) => (e.key === "Escape" && prompt ? repo.cancelTag() : undefined)} />

{#if prompt}
  <button class="scrim" aria-label={t("action.cancel")} onclick={() => repo.cancelTag()}></button>

  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="tag-title">
    <h2 id="tag-title">{t("tag.dialog.title")}</h2>
    <p class="on">{t("tag.dialog.on", { oid: prompt.shortOid, summary: prompt.summary })}</p>

    <form onsubmit={submit}>
      <label>
        {t("tag.dialog.name")}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="v1.0.0"
          autofocus
          bind:value={name}
        />
      </label>

      <label>
        {t("tag.dialog.message")}
        <textarea rows="3" bind:value={message}></textarea>
      </label>
      <p class="note">{t("tag.dialog.message.hint")}</p>

      <div class="actions">
        <button type="button" class="ghost" onclick={() => repo.cancelTag()}>
          {t("action.cancel")}
        </button>
        <button type="submit" class="primary" disabled={!canSubmit}>
          {repo.creatingTag ? t("tag.dialog.busy") : t("tag.dialog.submit")}
        </button>
      </div>
    </form>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 60;
    border: none;
    padding: 0;
    background: var(--scrim);
    cursor: default;
  }
  .dialog {
    position: fixed;
    z-index: 61;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(420px, calc(100vw - 3rem));
    padding: 1.1rem 1.2rem 1rem;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 16px 48px var(--shadow-color);
  }
  h2 {
    margin: 0 0 0.4rem;
    font-size: 0.95rem;
    font-weight: 600;
  }
  /* Le commit visé : l'oid et le résumé, sur une ligne qui se tronque. */
  .on {
    margin: 0 0 0.9rem;
    font-size: 0.78rem;
    color: var(--text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.78rem;
    color: var(--text-dim);
  }
  input,
  textarea {
    padding: 0.4rem 0.5rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text);
    font-size: 0.85rem;
    font-family: inherit;
  }
  textarea {
    resize: vertical;
  }
  input:focus,
  textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
  .note {
    margin: -0.35rem 0 0;
    font-size: 0.74rem;
    line-height: 1.4;
    color: var(--text-faint);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.2rem;
  }
  .actions button {
    padding: 0.4rem 0.8rem;
    border-radius: 5px;
    font-size: 0.82rem;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .ghost {
    background: transparent;
    border-color: var(--border);
    color: var(--text-dim);
  }
  .ghost:hover {
    color: var(--text);
  }
  .primary {
    background: var(--accent);
    color: var(--accent-text);
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>

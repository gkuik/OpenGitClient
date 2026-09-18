<script lang="ts">
  import { t } from "../i18n.svelte";
  import { repo } from "../stores/repo.svelte";

  /*
    Barre d'upstream, GitKraken mot pour mot : « What remote/branch should
    "test2" push to and pull from? » · distant · / · nom · Submit · Cancel.

    Elle s'affiche avant le **premier** push d'une branche, tout en haut du
    dépôt, au-dessus de sa barre Pull / Push / Fetch — sur toute la largeur,
    comme chez GitKraken, parce que la question concerne le dépôt et non ce
    qu'on regarde, et qu'elle précède le geste dont cette barre porte le bouton. Rien n'est
    envoyé tant qu'elle est ouverte : c'est le suivi qui se décide ici, *push
    et pull*, et un choix silencieux aurait pu pointer la branche sur un distant
    qu'on ne voulait pas.

    Le focus est donné au **sélecteur de distant**, pas au champ du nom, comme
    chez GitKraken : le nom pré-rempli est le bon dans le cas courant, la seule
    vraie question est « vers quel distant ». Avec un seul distant le sélecteur
    n'a qu'une entrée ; il reste là pour dire lequel.
  */

  const prompt = $derived(repo.upstreamPrompt);

  // Brouillon local : la barre est ré-instanciée à chaque ouverture (elle est
  // sous un `{#if}`), donc rien à réinitialiser à la main.
  let remote = $state("");
  let name = $state("");
  let select: HTMLSelectElement | undefined = $state();

  $effect(() => {
    if (!prompt) return;
    // `origin` d'abord s'il existe, comme le backend le résoudrait ; sinon le
    // premier déclaré.
    remote = prompt.remotes.includes("origin") ? "origin" : prompt.remotes[0];
    name = prompt.branch;
    select?.focus();
  });

  // Un nom vide ou avec un espace n'est pas une référence : le bouton reste
  // gris plutôt que de laisser libgit2 refuser après coup.
  const valid = $derived(name.trim().length > 0 && !/\s/.test(name.trim()));

  function submit() {
    if (!valid) return;
    void repo.confirmUpstream(remote, name);
  }

  // Entrée soumet et Échap referme, depuis l'un ou l'autre champ. Entrée est
  // traitée ici et non laissée à la soumission implicite du formulaire, qui
  // n'est pas garantie sur un `<select>`.
  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      repo.cancelUpstream();
    }
  }
</script>

{#if prompt}
  <form
    class="upstream"
    aria-label={t("push.upstream.question", { branch: prompt.branch })}
    onsubmit={(e) => {
      e.preventDefault();
      submit();
    }}
  >
    <span class="question">{t("push.upstream.question", { branch: prompt.branch })}</span>
    <select
      class="remote"
      bind:this={select}
      bind:value={remote}
      aria-label={t("push.upstream.remote")}
      onkeydown={onKey}
    >
      {#each prompt.remotes as r (r)}
        <option value={r}>{r}</option>
      {/each}
    </select>
    <span class="slash" aria-hidden="true">/</span>
    <input
      class="name"
      type="text"
      bind:value={name}
      aria-label={t("push.upstream.name")}
      spellcheck="false"
      autocomplete="off"
      onkeydown={onKey}
    />
    <button type="submit" class="submit" disabled={!valid}>
      {t("push.upstream.submit")}
    </button>
    <button type="button" class="cancel" onclick={() => repo.cancelUpstream()}>
      {t("action.cancel")}
    </button>
  </form>
{/if}

<style>
  /* Une ligne, centrée dans la largeur de la fenêtre, sur un fond teinté qui
     la distingue de la barre du dépôt juste en dessous. */
  .upstream {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.45rem 0.7rem;
    border-bottom: 1px solid var(--border);
    background: var(--info-bg);
    font-size: 0.82rem;
    white-space: nowrap;
  }
  .question {
    color: var(--text);
  }
  /* Le sélecteur et le champ partagent le gabarit des champs de la boîte de
     commit ; `appearance: none` pour la même raison qu'au sélecteur de profil
     — un `<select>` natif impose sa hauteur, et les deux ne s'aligneraient pas. */
  .remote,
  .name {
    background-color: var(--bg-raised);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 0.3rem 0.6rem;
    font-size: 0.82rem;
    font-family: inherit;
    box-sizing: border-box;
  }
  .remote {
    padding-right: 1.9rem;
    background-image: var(--select-chevron);
    background-repeat: no-repeat;
    background-position: right 0.6rem center;
    background-size: 10px 6px;
    appearance: none;
    -webkit-appearance: none;
  }
  .name {
    width: 14rem;
  }
  .remote:focus,
  .name:focus {
    outline: none;
    border-color: var(--accent);
  }
  .slash {
    color: var(--text-dim);
  }
  .submit,
  .cancel {
    padding: 0.3rem 0.7rem;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }
  /* Vert chez GitKraken : l'action positive, celle qui envoie. */
  .submit {
    background: var(--ok-bg);
    border: 1px solid var(--ok);
    color: var(--ok);
  }
  .submit:hover:not(:disabled) {
    background: var(--ok-bg-hover);
  }
  .submit:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .cancel {
    background: var(--bg-raised);
    border: 1px solid var(--border);
    color: var(--text);
  }
  .cancel:hover {
    background: var(--bg);
  }
</style>

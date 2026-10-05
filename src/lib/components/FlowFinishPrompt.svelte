<script lang="ts">
  import { i18n, t } from "../i18n.svelte";
  import { repo } from "../stores/repo.svelte";

  /*
    Barre de fin d'une branche Git Flow : ce qui va se passer — « Merge
    feature/x into develop, then delete it » —, le tag pour une release ou un
    hotfix, Finish · Cancel.

    Même place et même mécanique que les barres d'upstream et de création :
    par-dessus la barre du dépôt, rien ne bouge en dessous. Rien n'est fait
    avant Finish : fusionner dans `main` puis supprimer une branche ne se
    déclenche pas sur un clic de bouton isolé.
  */

  const prompt = $derived(repo.finishPrompt);

  // « main and develop » : la liste est mise en forme par la langue, pas
  // recollée à la main.
  const lists = $derived(new Intl.ListFormat(i18n.locale, { type: "conjunction" }));
  const label = $derived(
    prompt
      ? t("flow.finishBar.label", { branch: prompt.branch, targets: lists.format(prompt.targets) })
      : "",
  );

  let tag = $state("");
  let message = $state("");
  let button: HTMLButtonElement | undefined = $state();

  $effect(() => {
    if (!prompt) return;
    tag = prompt.tag ?? "";
    message = "";
    button?.focus();
  });

  // Un tag avec un blanc n'est pas une référence : on ne l'envoie pas.
  const valid = $derived(!/\s/.test(tag.trim()) && !repo.flowRunning);

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      repo.cancelFinish();
    }
  }
</script>

<!-- Échap referme la barre, où que soit le focus : il est souvent sur le
     bouton Finish, que la barre a pris à l'ouverture. -->
<svelte:window onkeydown={(e) => prompt && onKey(e)} />

{#if prompt}
  <form
    class="finish-prompt"
    aria-label={label}
    onsubmit={(e) => {
      e.preventDefault();
      if (valid) void repo.finishFlow(prompt.tag === null ? null : tag, message);
    }}
  >
    <span class="label" title={label}>{label}</span>
    {#if prompt.tag !== null}
      <input
        class="field tag"
        type="text"
        bind:value={tag}
        aria-label={t("flow.finishBar.tag")}
        placeholder={t("flow.finishBar.tag")}
        title={t("flow.finishBar.tag.hint", { branch: prompt.targets[0] })}
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
      />
      <input
        class="field message"
        type="text"
        bind:value={message}
        aria-label={t("flow.finishBar.message")}
        placeholder={t("flow.finishBar.message")}
        disabled={tag.trim().length === 0}
      />
    {/if}
    <button type="submit" class="submit" disabled={!valid} bind:this={button}>
      {t("flow.finishBar.submit")}
    </button>
    <button type="button" class="cancel" onclick={() => repo.cancelFinish()}>
      {t("action.cancel")}
    </button>
  </form>
{/if}

<style>
  /* Gabarit des barres d'upstream et de création. */
  .finish-prompt {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0 0.7rem;
    border-bottom: 1px solid var(--border);
    background:
      linear-gradient(var(--info-bg), var(--info-bg)),
      var(--bg);
    font-size: 0.82rem;
    white-space: nowrap;
  }
  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text);
  }
  .field {
    background-color: var(--bg-raised);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 0.3rem 0.6rem;
    font-size: 0.82rem;
    font-family: inherit;
    box-sizing: border-box;
  }
  .field:focus {
    outline: none;
    border-color: var(--accent);
  }
  .field:disabled {
    opacity: 0.5;
  }
  .tag {
    width: 8rem;
    font-family: var(--mono);
    font-size: 0.78rem;
  }
  .message {
    width: 14rem;
  }
  .submit,
  .cancel {
    flex: none;
    padding: 0.3rem 0.7rem;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }
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

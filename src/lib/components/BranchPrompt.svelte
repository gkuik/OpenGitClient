<script lang="ts">
  import { t } from "../i18n.svelte";
  import { FLOW_PREFIX } from "../gitflow";
  import { repo } from "../stores/repo.svelte";

  /*
    Barre de création d'une branche : « New branch from <départ> » · nom ·
    Create branch · Cancel.

    Même place et même mécanique que la barre d'upstream : **par-dessus** la
    barre du dépôt, posée en absolu sur le repère `.top` d'`App.svelte`, donc
    rien ne bouge en dessous. Le bouton Branch l'ouvre sur HEAD ; les menus du
    graph et des branches l'ouvrent sur le commit visé. Le départ est nommé,
    parce que c'est la seule chose que le champ ne dit pas.

    La barre reste ouverte si la création échoue (nom pris, nom invalide,
    modifications qui seraient écrasées) : le bandeau d'erreur dit pourquoi, et
    le nom se corrige sur place.
  */

  const prompt = $derived(repo.branchPrompt);
  /*
    Une branche Git Flow : le préfixe est affiché devant le champ, hors de lui
    — il est imposé, on ne tape que le nom. Les blancs du nom deviennent des
    tirets à la création (`flowBranchName`), d'où un contrôle plus souple.
  */
  const flow = $derived(prompt?.flow ?? null);
  /** Renommage : le nom actuel. La barre est la même, le champ part de lui. */
  const rename = $derived(prompt?.rename ?? null);
  const label = $derived(
    !prompt
      ? ""
      : rename !== null
        ? t("branch.rename.label", { from: rename })
        : flow
          ? t(`flow.start.${flow}`, { from: prompt.from })
          : t("branch.create.label", { from: prompt.from }),
  );
  const placeholder = $derived(flow ? t(`flow.start.name.${flow}`) : t("branch.create.name"));

  // Brouillon local : la barre est ré-instanciée à chaque ouverture (elle est
  // sous un `{#if}`), mais un changement de départ sans fermeture — un second
  // clic droit « Create branch here » — doit aussi repartir d'un champ vide.
  let name = $state("");
  let input: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (!prompt) return;
    void prompt.oid;
    name = prompt.rename ?? "";
    input?.focus();
    // Un renommage part du nom actuel, sélectionné : taper le remplace, les
    // flèches le retouchent.
    if (prompt.rename !== undefined) input?.select();
  });

  // Un nom vide ou avec un espace n'est pas une référence : le bouton reste
  // gris plutôt que de laisser le backend refuser après coup. Le reste des
  // règles (`..`, `~`, `:`…) est vérifié par le backend, qui nomme le refus.
  const valid = $derived(
    name.trim().length > 0 &&
      (flow !== null || !/\s/.test(name.trim())) &&
      !repo.checkingOut &&
      // Le même nom ne renomme rien.
      name.trim() !== rename,
  );

  function submit() {
    if (!valid) return;
    void repo.createBranch(name);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      repo.cancelBranch();
    }
  }
</script>

{#if prompt}
  <form
    class="branch-prompt"
    aria-label={label}
    onsubmit={(e) => {
      e.preventDefault();
      submit();
    }}
  >
    <span class="label">{label}</span>
    {#if flow}
      <span class="prefix">{FLOW_PREFIX[flow]}</span>
    {/if}
    <input
      class="name"
      type="text"
      bind:this={input}
      bind:value={name}
      aria-label={placeholder}
      {placeholder}
      spellcheck="false"
      autocomplete="off"
      autocapitalize="off"
      onkeydown={onKey}
    />
    <button type="submit" class="submit" disabled={!valid}>
      {rename !== null ? t("branch.rename.submit") : t("branch.create.submit")}
    </button>
    <button type="button" class="cancel" onclick={() => repo.cancelBranch()}>
      {t("action.cancel")}
    </button>
  </form>
{/if}

<style>
  /* Gabarit de la barre d'upstream : une ligne centrée qui recouvre la barre
     du dépôt, fond opaque teinté. */
  .branch-prompt {
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
  .name {
    width: 16rem;
    background-color: var(--bg-raised);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 0.3rem 0.6rem;
    font-size: 0.82rem;
    font-family: inherit;
    box-sizing: border-box;
  }
  /* Le préfixe imposé, collé au champ : il fait partie du nom, mais ne se
     tape pas. */
  .prefix {
    flex: none;
    display: flex;
    align-items: center;
    box-sizing: border-box;
    margin-right: -0.5rem;
    padding: 0.3rem 0.45rem 0.3rem 0.6rem;
    border: 1px solid var(--border);
    border-right: none;
    border-radius: 6px 0 0 6px;
    background: var(--bg);
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 0.78rem;
  }
  /* Même hauteur imposée aux deux : leurs polices diffèrent, leurs boîtes
     aussi sinon. */
  .prefix,
  .prefix + .name {
    height: 1.95rem;
  }
  .prefix + .name {
    border-radius: 0 6px 6px 0;
  }
  .name:focus {
    outline: none;
    border-color: var(--accent);
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

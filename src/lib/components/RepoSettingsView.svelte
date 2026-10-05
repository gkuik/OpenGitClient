<script lang="ts">
  /*
    Paramètres **du dépôt affiché** — le pendant de `SettingsView`, qui porte
    sur l'application. Ils prennent la place des trois colonnes de l'onglet,
    la barre du dépôt restant au-dessus : la roue dentée qui les ouvre est à
    côté du nom, et c'est elle (ou « Back to the graph ») qui les referme.

    Deux sortes de réglages, rangés à deux endroits différents, et c'est voulu :
    le nom d'affichage n'existe que pour l'application (`projects.json`),
    l'identité et les distants sont du Git et vivent dans `.git/config`, où
    n'importe quel autre outil les lit. Rien de ces derniers n'est recopié.

    Monté sous un `{#key}` sur le dépôt (voir `App.svelte`) : les brouillons de
    formulaire sont locaux au composant et ne doivent pas suivre d'un onglet à
    l'autre.
  */
  import { errorMessage, t } from "../i18n.svelte";
  import { repo, tabs } from "../stores/repo.svelte";
  import RichText from "./RichText.svelte";
  import { defaultFlowConfig, isPattern } from "../gitflow";
  import type { AppError, GitFlowConfig, RemoteEntry } from "../types";

  // ── Nom d'affichage ─────────────────────────────────────────────────────────

  let aliasDraft = $state(repo.alias ?? "");
  let aliasError = $state<AppError | null>(null);
  let savingAlias = $state(false);
  const aliasChanged = $derived(aliasDraft.trim() !== (repo.alias ?? ""));

  async function saveAlias(value: string | null) {
    savingAlias = true;
    const tab = tabs.active;
    aliasError = tab ? await tabs.setAlias(tab, value) : null;
    savingAlias = false;
    if (!aliasError) aliasDraft = repo.alias ?? "";
  }

  // ── Identité ────────────────────────────────────────────────────────────────

  /** Option « identité saisie à la main », propre au dépôt et à aucun profil. */
  const CUSTOM = "__custom";
  /** Raccourci vers les paramètres de l'application, où se gèrent les profils. */
  const MANAGE = "__manage";

  const identity = $derived(repo.identity);
  const active = $derived(repo.activeProfile(tabs.profiles));
  /** Identité locale qui ne correspond à aucun profil : c'est une identité saisie. */
  const unmatched = $derived(identity?.isLocal === true && active === null);
  /** Le formulaire de saisie a été demandé, avant même qu'une identité y soit écrite. */
  let customOpen = $state(false);
  const selected = $derived(
    customOpen || unmatched ? CUSTOM : active ? active.id : "",
  );
  const showCustom = $derived(selected === CUSTOM);

  let customName = $state("");
  let customEmail = $state("");
  /** Vrai dès qu'on tape : l'identité relue ne doit plus écraser la saisie. */
  let customDirty = $state(false);
  let identityError = $state<AppError | null>(null);
  let savingIdentity = $state(false);

  // Pré-remplit la saisie avec l'identité effective, tant qu'on n'y a pas touché.
  $effect(() => {
    if (customDirty) return;
    customName = identity?.name ?? "";
    customEmail = identity?.email ?? "";
  });

  const customValid = $derived(customName.trim().length > 0 && customEmail.trim().length > 0);
  const customChanged = $derived(
    !identity?.isLocal ||
      customName.trim() !== (identity?.name ?? "") ||
      customEmail.trim() !== (identity?.email ?? ""),
  );

  function pick(event: Event & { currentTarget: HTMLSelectElement }) {
    const value = event.currentTarget.value;
    identityError = null;
    if (value === MANAGE) {
      // Rien n'a changé côté dépôt : le sélecteur doit retrouver sa valeur, que
      // l'état dérivé ne réécrira pas puisqu'il n'a pas bougé.
      event.currentTarget.value = selected;
      tabs.openSettings();
      return;
    }
    if (value === CUSTOM) {
      customOpen = true;
      return;
    }
    customOpen = false;
    customDirty = false;
    void repo.applyProfile(tabs.profiles.find((p) => p.id === value) ?? null);
  }

  async function saveCustom() {
    if (!customValid || savingIdentity) return;
    savingIdentity = true;
    identityError = await repo.setCustomIdentity(customName, customEmail);
    savingIdentity = false;
    if (!identityError) {
      customDirty = false;
      customOpen = false;
    }
  }

  // ── Git Flow ────────────────────────────────────────────────────────────────

  /*
    Chaque geste est enregistré aussitôt — une case, une flèche, une entrée
    retirée — : c'est ce qui fait bouger le graph derrière, qu'on voit en
    refermant l'écran. Les deux noms de branche le sont à la validation du
    champ (`change`), pas à chaque frappe.
  */
  const flow = $derived(repo.flowConfig);
  let flowError = $state<AppError | null>(null);
  let newEntry = $state("");

  async function saveFlow(next: GitFlowConfig) {
    flowError = await repo.saveGitFlow(next);
  }

  /**
   * Renomme une branche pérenne, et son entrée dans l'ordre avec elle : qui
   * passe de `develop` à `dev` veut garder la colonne, pas la perdre.
   */
  function renameRole(role: "main" | "develop", value: string) {
    const name = value.trim();
    const previous = flow[role];
    if (!name || name === previous) return;
    const order = flow.order.includes(name)
      ? flow.order
      : flow.order.map((e) => (e === previous ? name : e));
    void saveFlow({ ...flow, [role]: name, order });
  }

  function moveEntry(index: number, delta: -1 | 1) {
    const order = [...flow.order];
    const [entry] = order.splice(index, 1);
    order.splice(index + delta, 0, entry);
    void saveFlow({ ...flow, order });
  }

  function removeEntry(index: number) {
    void saveFlow({ ...flow, order: flow.order.filter((_, i) => i !== index) });
  }

  function addEntry() {
    const entry = newEntry.trim();
    newEntry = "";
    if (!entry || flow.order.includes(entry)) return;
    void saveFlow({ ...flow, order: [...flow.order, entry] });
  }

  function resetOrder() {
    const defaults = defaultFlowConfig(repo.branches.map((b) => b.name));
    const order = defaults.order.map((e) =>
      e === defaults.main ? flow.main : e === defaults.develop ? flow.develop : e,
    );
    void saveFlow({ ...flow, order });
  }

  // ── Distants ────────────────────────────────────────────────────────────────

  /** Distant en cours d'édition : son nom actuel, et ce qu'on en fait. */
  let editing = $state<{ name: string; newName: string; url: string } | null>(null);
  /** Formulaire d'ajout ouvert. */
  let adding = $state<{ name: string; url: string } | null>(null);
  /** Suppression armée : le second clic l'exécute. */
  let confirmDelete = $state<string | null>(null);
  let remoteError = $state<AppError | null>(null);
  let savingRemote = $state(false);

  const editValid = $derived(
    editing !== null && editing.newName.trim().length > 0 && editing.url.trim().length > 0,
  );
  const addValid = $derived(
    adding !== null && adding.name.trim().length > 0 && adding.url.trim().length > 0,
  );

  function startEdit(remote: RemoteEntry) {
    adding = null;
    confirmDelete = null;
    remoteError = null;
    editing = { name: remote.name, newName: remote.name, url: remote.url };
  }

  function startAdd() {
    editing = null;
    confirmDelete = null;
    remoteError = null;
    // Le premier distant s'appelle presque toujours `origin` : c'est ce que
    // propose `git clone`, et ce que le champ suggère sans l'imposer.
    adding = { name: repo.remoteEntries?.length ? "" : "origin", url: "" };
  }

  /** Écrit un distant ; le formulaire ne se ferme qu'en cas de succès. */
  async function runRemote(write: () => Promise<AppError | null>, done: () => void) {
    savingRemote = true;
    remoteError = await write();
    savingRemote = false;
    if (!remoteError) done();
  }

  function saveEdit() {
    const e = editing;
    if (!e || !editValid || savingRemote) return;
    void runRemote(
      () => repo.editRemote(e.name, e.newName, e.url),
      () => (editing = null),
    );
  }

  function saveAdd() {
    const a = adding;
    if (!a || !addValid || savingRemote) return;
    void runRemote(
      () => repo.addRemote(a.name.trim(), a.url),
      () => (adding = null),
    );
  }

  function removeRemote(name: string) {
    if (confirmDelete !== name) {
      confirmDelete = name;
      return;
    }
    confirmDelete = null;
    void runRemote(
      () => repo.deleteRemote(name),
      () => {
        if (editing?.name === name) editing = null;
      },
    );
  }
</script>

<div class="settings">
  <div class="sheet">
    <header>
      <button class="back" onclick={() => repo.closeSettings()}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M10 3.5 5.5 8l4.5 4.5" />
        </svg>
        {t("repoSettings.back")}
      </button>
      <h1>{t("repoSettings.title")}</h1>
      <p class="path" title={repo.repoId}>{repo.repoId}</p>
    </header>

    <!-- ── Nom d'affichage ──────────────────────────────────────────────── -->
    <section>
      <h2>{t("repoSettings.alias")}</h2>
      <p class="intro">
        <RichText
          key="repoSettings.alias.intro"
          params={{ folder: { text: repo.repoInfo?.name ?? "", tag: "strong" } }}
        />
      </p>
      <form
        class="inline"
        onsubmit={(e) => {
          e.preventDefault();
          if (aliasChanged) void saveAlias(aliasDraft);
        }}
      >
        <input
          type="text"
          aria-label={t("repoSettings.alias")}
          placeholder={repo.repoInfo?.name ?? ""}
          spellcheck="false"
          bind:value={aliasDraft}
        />
        <button type="submit" class="primary" disabled={!aliasChanged || savingAlias}>
          {savingAlias ? t("action.saving") : t("action.save")}
        </button>
        <button
          type="button"
          class="ghost"
          disabled={!repo.alias || savingAlias}
          onclick={() => saveAlias(null)}
        >
          {t("repoSettings.alias.reset")}
        </button>
      </form>
      {#if aliasError}
        <p class="error">{errorMessage(aliasError)}</p>
      {/if}
    </section>

    <!-- ── Identité ─────────────────────────────────────────────────────── -->
    <section>
      <h2>{t("repoSettings.identity")}</h2>
      <p class="intro">
        <RichText
          key="repoSettings.identity.intro"
          params={{
            config: { text: ".git/config", tag: "code" },
            global: { text: t("commit.author.global"), tag: "strong" },
          }}
        />
      </p>

      <div class="card">
        {#if identity?.name || identity?.email}
          <div class="who">
            <span class="ident">{identity.name ?? "—"} &lt;{identity.email ?? "—"}&gt;</span>
            <span class="origin" class:local={identity.isLocal}>
              {identity.isLocal
                ? t("repoSettings.identity.local")
                : t("repoSettings.identity.inherited")}
            </span>
          </div>
        {:else}
          <p class="warn">{t("repoSettings.identity.none")}</p>
        {/if}

        <select
          class="select"
          aria-label={t("repoSettings.identity.aria")}
          value={selected}
          disabled={!repo.repoInfo}
          onchange={pick}
        >
          <option value="">{t("commit.author.global")}</option>
          {#each tabs.profiles as profile (profile.id)}
            <option value={profile.id}>{profile.label} · {profile.name}</option>
          {/each}
          <option value={CUSTOM}>{t("repoSettings.identity.custom")}</option>
          <option value={MANAGE}>{t("repoSettings.identity.manage")}</option>
        </select>

        {#if showCustom}
          <form
            onsubmit={(e) => {
              e.preventDefault();
              void saveCustom();
            }}
          >
            <label>
              {t("settings.profiles.name")}
              <input
                type="text"
                placeholder={t("settings.profiles.name.placeholder")}
                bind:value={customName}
                oninput={() => (customDirty = true)}
              />
            </label>
            <label>
              {t("settings.profiles.email")}
              <input
                type="email"
                autocapitalize="off"
                spellcheck="false"
                bind:value={customEmail}
                oninput={() => (customDirty = true)}
              />
            </label>
            <div class="actions">
              <span class="spacer"></span>
              <button
                type="submit"
                class="primary"
                disabled={!customValid || !customChanged || savingIdentity}
              >
                {savingIdentity ? t("action.saving") : t("action.save")}
              </button>
            </div>
          </form>
        {/if}
      </div>
      {#if identityError}
        <p class="error">{errorMessage(identityError)}</p>
      {/if}
    </section>

    <!-- ── Git Flow ─────────────────────────────────────────────────────── -->
    <section>
      <h2>{t("repoSettings.flow")}</h2>
      <p class="intro">
        <RichText
          key="repoSettings.flow.intro"
          params={{
            main: { text: flow.main, tag: "code" },
            develop: { text: flow.develop, tag: "code" },
          }}
        />
      </p>

      <label class="check">
        <input
          type="checkbox"
          checked={flow.enabled}
          disabled={!repo.repoInfo}
          onchange={(e) => saveFlow({ ...flow, enabled: e.currentTarget.checked })}
        />
        {t("repoSettings.flow.enable")}
      </label>

      {#if flow.enabled}
        <div class="card flow">
          <div class="pair">
            <label>
              {t("repoSettings.flow.main")}
              <input
                type="text"
                list="flow-branches"
                spellcheck="false"
                autocapitalize="off"
                value={flow.main}
                onchange={(e) => renameRole("main", e.currentTarget.value)}
              />
            </label>
            <label>
              {t("repoSettings.flow.develop")}
              <input
                type="text"
                list="flow-branches"
                spellcheck="false"
                autocapitalize="off"
                value={flow.develop}
                onchange={(e) => renameRole("develop", e.currentTarget.value)}
              />
            </label>
            <datalist id="flow-branches">
              {#each repo.branches as b (b.name)}
                <option value={b.name}></option>
              {/each}
            </datalist>
          </div>

          <h3>{t("repoSettings.flow.order")}</h3>
          <p class="hint">
            <RichText
              key="repoSettings.flow.order.intro"
              params={{
                star: { text: "*", tag: "code" },
                example: { text: "release/*", tag: "code" },
              }}
            />
          </p>

          <ol class="order">
            {#each flow.order as entry, i (entry)}
              <li>
                <span class="rank">{i + 1}</span>
                <span class="entry" class:group={isPattern(entry)}>{entry}</span>
                <button
                  class="icon"
                  title={t("repoSettings.flow.order.up")}
                  aria-label={t("repoSettings.flow.order.up")}
                  disabled={i === 0}
                  onclick={() => moveEntry(i, -1)}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3.5 10 8 5.5l4.5 4.5" />
                  </svg>
                </button>
                <button
                  class="icon"
                  title={t("repoSettings.flow.order.down")}
                  aria-label={t("repoSettings.flow.order.down")}
                  disabled={i === flow.order.length - 1}
                  onclick={() => moveEntry(i, 1)}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3.5 6 8 10.5 12.5 6" />
                  </svg>
                </button>
                <button
                  class="icon"
                  title={t("repoSettings.flow.order.remove")}
                  aria-label={t("repoSettings.flow.order.remove")}
                  onclick={() => removeEntry(i)}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
                    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
                  </svg>
                </button>
              </li>
            {:else}
              <li class="empty">{t("repoSettings.flow.order.empty")}</li>
            {/each}
          </ol>

          <form
            class="inline"
            onsubmit={(e) => {
              e.preventDefault();
              addEntry();
            }}
          >
            <input
              type="text"
              list="flow-branches"
              spellcheck="false"
              autocapitalize="off"
              aria-label={t("repoSettings.flow.order.add")}
              placeholder={t("repoSettings.flow.order.add")}
              bind:value={newEntry}
            />
            <button
              type="submit"
              class="ghost"
              disabled={!newEntry.trim() || flow.order.includes(newEntry.trim())}
            >
              {t("action.add")}
            </button>
            <button type="button" class="ghost" onclick={resetOrder}>
              {t("repoSettings.flow.order.reset")}
            </button>
          </form>
        </div>
      {/if}
      {#if flowError}
        <p class="error">{errorMessage(flowError)}</p>
      {/if}
    </section>

    <!-- ── Distants ─────────────────────────────────────────────────────── -->
    <section>
      <h2>{t("repoSettings.remotes")}</h2>
      <p class="intro">
        <RichText
          key="repoSettings.remotes.intro"
          params={{ config: { text: ".git/config", tag: "code" } }}
        />
      </p>

      {#if repo.remoteEntries === null}
        <p class="muted">{t("common.loading")}</p>
      {:else}
        <ul class="list">
          {#each repo.remoteEntries as remote (remote.name)}
            <li class:editing={editing?.name === remote.name}>
              <div class="head">
                <div class="who">
                  <span class="label">{remote.name}</span>
                  <span class="ident">{remote.url}</span>
                  {#if remote.pushUrl}
                    <span class="note">
                      {t("repoSettings.remotes.pushUrl", { url: remote.pushUrl })}
                    </span>
                  {/if}
                </div>

                {#if confirmDelete === remote.name}
                  <button
                    class="danger"
                    disabled={savingRemote || repo.busyRemote}
                    title={t("repoSettings.remotes.delete.hint")}
                    onclick={() => removeRemote(remote.name)}
                  >
                    {t("repoSettings.remotes.delete.confirm")}
                  </button>
                  <button class="ghost" onclick={() => (confirmDelete = null)}>
                    {t("action.cancel")}
                  </button>
                {:else if editing?.name !== remote.name}
                  <button class="ghost" disabled={savingRemote} onclick={() => startEdit(remote)}>
                    {t("action.edit")}
                  </button>
                  <!-- Retirer un distant réécrit `refs/remotes/**`, comme le
                       fait une opération réseau : le backend refuse pendant
                       qu'elle tourne, le bouton le dit d'avance. -->
                  <button
                    class="danger"
                    disabled={savingRemote || repo.busyRemote}
                    title={t("repoSettings.remotes.delete.hint")}
                    onclick={() => removeRemote(remote.name)}
                  >
                    {t("action.delete")}
                  </button>
                {/if}
              </div>

              {#if editing?.name === remote.name}
                <form
                  onsubmit={(e) => {
                    e.preventDefault();
                    saveEdit();
                  }}
                >
                  <label>
                    {t("repoSettings.remotes.name")}
                    <input
                      type="text"
                      autocapitalize="off"
                      spellcheck="false"
                      bind:value={editing.newName}
                    />
                  </label>
                  <label>
                    {t("repoSettings.remotes.url")}
                    <input
                      type="text"
                      autocapitalize="off"
                      spellcheck="false"
                      bind:value={editing.url}
                    />
                  </label>
                  <div class="actions">
                    <button type="button" class="ghost" onclick={() => (editing = null)}>
                      {t("action.cancel")}
                    </button>
                    <span class="spacer"></span>
                    <!-- Un renommage pendant une opération réseau est refusé
                         par le backend, pour la même raison qu'une suppression. -->
                    <button
                      type="submit"
                      class="primary"
                      disabled={!editValid ||
                        savingRemote ||
                        (repo.busyRemote && editing.newName.trim() !== editing.name)}
                    >
                      {savingRemote ? t("action.saving") : t("action.save")}
                    </button>
                  </div>
                </form>
              {/if}
            </li>
          {:else}
            <li class="empty">{t("repoSettings.remotes.empty")}</li>
          {/each}
        </ul>

        {#if adding}
          <form
            class="draft"
            onsubmit={(e) => {
              e.preventDefault();
              saveAdd();
            }}
          >
            <label>
              {t("repoSettings.remotes.name")}
              <input
                type="text"
                autocapitalize="off"
                spellcheck="false"
                placeholder={t("repoSettings.remotes.name.placeholder")}
                bind:value={adding.name}
              />
            </label>
            <label>
              {t("repoSettings.remotes.url")}
              <input
                type="text"
                autocapitalize="off"
                spellcheck="false"
                placeholder={t("repoSettings.remotes.url.placeholder")}
                bind:value={adding.url}
              />
            </label>
            <div class="actions">
              <button type="button" class="ghost" onclick={() => (adding = null)}>
                {t("action.cancel")}
              </button>
              <span class="spacer"></span>
              <button type="submit" class="primary" disabled={!addValid || savingRemote}>
                {savingRemote ? t("action.saving") : t("action.add")}
              </button>
            </div>
          </form>
        {:else}
          <button class="ghost add" onclick={startAdd}>{t("repoSettings.remotes.add")}</button>
        {/if}
      {/if}

      {#if remoteError}
        <p class="error">{errorMessage(remoteError)}</p>
      {/if}
    </section>
  </div>
</div>

<style>
  /* La feuille reprend celle des paramètres de l'application : même largeur,
     mêmes titres, mêmes cartes — deux écrans de réglages qui se ressemblent
     se lisent de la même façon. */
  .settings {
    height: 100%;
    overflow-y: auto;
    background: var(--bg);
  }
  .sheet {
    max-width: 680px;
    margin: 0 auto;
    padding: 1.25rem 1.5rem 3rem;
  }
  header {
    margin-bottom: 1.4rem;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    margin: 0 0 0.75rem -0.45rem;
    padding: 0.25rem 0.45rem;
    border: none;
    background: transparent;
    color: var(--text-dim);
  }
  .back:hover {
    color: var(--text);
    background: var(--bg-raised);
  }
  .back svg {
    display: block;
    width: 14px;
    height: 14px;
  }
  h1 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
  }
  .path {
    margin: 0.25rem 0 0;
    font-family: var(--mono);
    font-size: 0.72rem;
    color: var(--text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  section {
    margin-bottom: 1.6rem;
  }
  h2 {
    margin: 0 0 0.5rem;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .intro {
    margin: 0 0 1rem;
    font-size: 0.82rem;
    line-height: 1.5;
    color: var(--text-dim);
  }
  /* `:global` parce que ces `<code>` sont rendus par `RichText`. */
  .intro :global(code) {
    font-family: var(--mono);
    font-size: 0.76rem;
  }
  .muted {
    margin: 0 0 1rem;
    font-size: 0.82rem;
    color: var(--text-faint);
  }
  .error {
    margin: 0.6rem 0 0;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--danger-border);
    border-radius: 6px;
    background: var(--danger-bg);
    color: var(--danger-soft);
    font-size: 0.82rem;
  }
  .warn {
    margin: 0;
    font-size: 0.82rem;
    color: var(--warn);
  }

  .card,
  .list li,
  .draft {
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--bg-raised);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .list {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .list li.editing,
  .draft {
    border-color: var(--accent);
  }
  .list li.empty {
    color: var(--text-faint);
    font-size: 0.82rem;
    border-style: dashed;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .who {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
    flex: 1;
  }
  .label {
    font-size: 0.85rem;
    font-weight: 600;
  }
  .ident {
    font-family: var(--mono);
    font-size: 0.76rem;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .list .ident {
    font-size: 0.72rem;
    color: var(--text-faint);
  }
  .note,
  .origin {
    font-size: 0.72rem;
    color: var(--text-faint);
  }
  .origin.local {
    color: var(--ok-soft);
  }

  /* Git Flow. */
  .check {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    font-size: 0.84rem;
    color: var(--text);
    cursor: pointer;
  }
  .check input {
    margin: 0;
    accent-color: var(--accent);
  }
  .card.flow {
    gap: 0.75rem;
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
  }
  h3 {
    margin: 0.25rem 0 0;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text);
  }
  .hint {
    margin: -0.4rem 0 0;
    font-size: 0.76rem;
    line-height: 1.45;
    color: var(--text-dim);
  }
  .hint :global(code) {
    font-family: var(--mono);
    font-size: 0.72rem;
  }
  .order {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .order li {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem 0.25rem 0.2rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg);
  }
  .order li.empty {
    padding: 0.4rem 0.5rem;
    border-style: dashed;
    color: var(--text-faint);
    font-size: 0.8rem;
  }
  .rank {
    flex: none;
    width: 1.1rem;
    font-size: 0.72rem;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .entry {
    flex: 1;
    min-width: 0;
    font-family: var(--mono);
    font-size: 0.78rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Un groupe se distingue d'un nom : ce n'est pas une branche, c'est une
     famille de branches. */
  .entry.group {
    color: var(--info);
  }
  .icon {
    flex: none;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-faint);
  }
  .icon:hover:not(:disabled) {
    color: var(--text);
    background: var(--bg-raised);
  }
  .icon svg {
    display: block;
    width: 13px;
    height: 13px;
  }

  /* Le nom d'affichage : le champ et ses deux boutons sur une ligne. */
  .inline {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .inline input {
    flex: 1;
    min-width: 0;
  }

  form:not(.inline) {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  /* Le formulaire d'édition est sous la ligne qu'il modifie : un filet l'en
     sépare. Celui d'ajout et celui de l'identité n'ont rien au-dessus. */
  .list li form {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }
  .draft {
    margin-bottom: 0.25rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.76rem;
    color: var(--text-dim);
  }
  input,
  .select {
    padding: 0.38rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg);
    color: var(--text);
    font-size: 0.84rem;
    font-family: inherit;
  }
  input:focus,
  .select:focus {
    outline: none;
    border-color: var(--accent);
  }
  /* Même parti que le sélecteur de la boîte de commit : un `<select>` natif
     impose sa hauteur et son bouton bleu, on peint donc le chevron soi-même
     pour qu'il s'aligne sur les champs. */
  .select {
    appearance: none;
    -webkit-appearance: none;
    padding-right: 1.6rem;
    background-image: linear-gradient(45deg, transparent 50%, var(--text-faint) 50%),
      linear-gradient(135deg, var(--text-faint) 50%, transparent 50%);
    background-position:
      calc(100% - 0.85rem) 50%,
      calc(100% - 0.55rem) 50%;
    background-size: 0.3rem 0.3rem;
    background-repeat: no-repeat;
    cursor: pointer;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .spacer {
    flex: 1;
  }

  button {
    padding: 0.35rem 0.7rem;
    border: 1px solid transparent;
    border-radius: 5px;
    font-size: 0.8rem;
    font-family: inherit;
    cursor: pointer;
  }
  .ghost {
    flex: none;
    background: transparent;
    border-color: var(--border);
    color: var(--text-dim);
  }
  .ghost:hover:not(:disabled) {
    color: var(--text);
  }
  .primary {
    flex: none;
    background: var(--accent);
    color: var(--accent-text);
  }
  .danger {
    flex: none;
    background: transparent;
    border-color: var(--danger-border);
    color: var(--danger-soft);
  }
  .danger:hover:not(:disabled) {
    background: var(--danger-bg);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>

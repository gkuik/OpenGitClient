<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { font, FONT_SIZES } from "../font.svelte";
  import { graphLines, GRAPH_LINE_STYLES, hasRoundness } from "../graphLines.svelte";
  import { errorMessage, t } from "../i18n.svelte";
  import { tabs } from "../stores/repo.svelte";
  import { theme } from "../theme.svelte";
  import RichText from "./RichText.svelte";
  import type { AppError, GraphLineStyle, Profile, ThemeMode } from "../types";

  /** Les trois thèmes proposés, dans l'ordre d'affichage du segmenté. */
  const THEMES: { mode: ThemeMode; label: string }[] = $derived([
    { mode: "light", label: t("settings.theme.light") },
    { mode: "dark", label: t("settings.theme.dark") },
    { mode: "system", label: t("settings.theme.system") },
  ]);

  /** Libellés des tracés du graph, dans l'ordre du segmenté. */
  const LINE_LABELS = $derived<Record<GraphLineStyle, string>>({
    rounded: t("settings.graph.rounded"),
    sharp: t("settings.graph.sharp"),
    curve: t("settings.graph.curve"),
    diagonal: t("settings.graph.diagonal"),
  });

  /** Profil en cours d'édition. `id` à null = création. */
  type Draft = { id: string | null; label: string; name: string; email: string };

  let draft = $state<Draft | null>(null);
  let savingProfile = $state(false);
  /** Suppression confirmée en deux temps, comme l'oubli d'un jeton. */
  let confirmDelete = $state<string | null>(null);

  const draftValid = $derived(
    draft !== null &&
      draft.label.trim().length > 0 &&
      draft.name.trim().length > 0 &&
      draft.email.trim().length > 0,
  );

  function newProfile() {
    draft = { id: null, label: "", name: "", email: "" };
    confirmDelete = null;
  }

  function editProfile(profile: Profile) {
    draft = { ...profile };
    confirmDelete = null;
  }

  async function saveDraft() {
    if (!draft || !draftValid || savingProfile) return;
    savingProfile = true;
    error = null;
    try {
      await api.saveProfile(
        draft.id,
        draft.label.trim(),
        draft.name.trim(),
        draft.email.trim(),
      );
      await tabs.loadProfiles();
      draft = null;
    } catch (e) {
      error = e as AppError;
    } finally {
      savingProfile = false;
    }
  }

  async function removeProfile(id: string) {
    error = null;
    try {
      await api.deleteProfile(id);
      await tabs.loadProfiles();
      confirmDelete = null;
      if (draft?.id === id) draft = null;
    } catch (e) {
      error = e as AppError;
    }
  }

  /** Un hôte distant et l'état de ses identifiants. */
  type HostRow = {
    host: string;
    /** Dépôts ouverts qui pointent dessus — sert à situer l'hôte d'un coup d'œil. */
    repos: string[];
    stored: boolean;
  };

  let rows = $state<HostRow[]>([]);
  let loading = $state(true);
  let error = $state<AppError | null>(null);

  // Saisie en cours : un seul hôte modifiable à la fois.
  let editing = $state<string | null>(null);
  let username = $state("");
  let secret = $state("");
  let saving = $state(false);
  /** Suppression confirmée en deux temps, faute de dialogue natif déclaré. */
  let confirmForget = $state(false);

  // Hôte ajouté à la main, pour un dépôt qui n'est pas ouvert.
  let newHost = $state("");

  /**
   * Recense les hôtes des dépôts ouverts. Seul le backend sait quel distant un
   * fetch interrogerait, d'où un aller-retour par onglet ; un dépôt sans distant
   * remonte une erreur qu'on ignore simplement.
   */
  async function load() {
    loading = true;
    const found = new Map<string, HostRow>();
    // Les pages « Nouvel onglet » n'ont pas de dépôt, donc pas de distant.
    for (const tab of tabs.repoTabs) {
      try {
        const remote = await api.getRemoteInfo(tab.repoId);
        // Un distant SSH n'a que faire d'un jeton pour ses fetch : le lister
        // inviterait à en saisir un qui ne servirait jamais. **Sauf** s'il y a
        // une forge derrière : son API, elle, en réclame un — c'est le jeton
        // que lit la section PULL REQUESTS, transport Git ou pas.
        if (!remote.host || !(remote.usesHttp || remote.forge)) continue;
        const row = found.get(remote.host) ?? {
          host: remote.host,
          repos: [],
          stored: remote.hasCredentials,
        };
        const name = tab.repoInfo?.name;
        if (name && !row.repos.includes(name)) row.repos.push(name);
        found.set(remote.host, row);
      } catch {
        /* dépôt sans distant : rien à paramétrer */
      }
    }
    // Les hôtes ajoutés à la main restent listés même sans dépôt ouvert.
    for (const row of rows) {
      if (!found.has(row.host) && row.repos.length === 0) found.set(row.host, row);
    }
    rows = [...found.values()].sort((a, b) => a.host.localeCompare(b.host));
    loading = false;
  }

  // Au montage, et une seule fois : l'écran est démonté dès qu'on le quitte, et
  // ouvrir un dépôt referme les paramètres (voir `TabsStore.open`). Un `$effect`
  // rebouclerait ici, `load` lisant `rows` pour conserver les hôtes ajoutés à la
  // main avant de le réécrire.
  onMount(load);

  function edit(host: string) {
    editing = host;
    username = "";
    secret = "";
    confirmForget = false;
  }

  function cancel() {
    editing = null;
    secret = "";
    confirmForget = false;
  }

  async function save(host: string) {
    if (username.trim().length === 0 || secret.length === 0 || saving) return;
    saving = true;
    error = null;
    try {
      await api.setCredentials(host, username.trim(), secret);
      // Ne pas garder le secret en mémoire une fois transmis.
      secret = "";
      editing = null;
      await refresh(host);
      // Le jeton qu'on vient d'enregistrer est peut-être celui qui manquait à
      // une section PULL REQUESTS : elle a affiché son message et n'a aucune
      // raison de le redemander toute seule. Seuls les onglets en échec sont
      // relancés — les autres n'ont rien à revoir.
      for (const tab of tabs.repoTabs) {
        if (tab.prError) void tab.loadPullRequests();
      }
    } catch (e) {
      error = e as AppError;
    } finally {
      saving = false;
    }
  }

  async function forget(host: string) {
    error = null;
    try {
      await api.forgetCredentials(host);
      editing = null;
      confirmForget = false;
      await refresh(host);
    } catch (e) {
      error = e as AppError;
    }
  }

  async function refresh(host: string) {
    const stored = await api.hasCredentials(host).catch(() => false);
    rows = rows.map((row) => (row.host === host ? { ...row, stored } : row));
  }

  async function addHost() {
    const host = newHost.trim().toLowerCase();
    if (host.length === 0 || rows.some((r) => r.host === host)) {
      newHost = "";
      return;
    }
    const stored = await api.hasCredentials(host).catch(() => false);
    rows = [...rows, { host, repos: [], stored }].sort((a, b) =>
      a.host.localeCompare(b.host),
    );
    newHost = "";
    edit(host);
  }
</script>

<div class="settings">
  <div class="sheet">
    <header>
      <h1>{t("settings.title")}</h1>
    </header>

    <section>
      <h2>{t("settings.appearance")}</h2>
      <p class="intro">
        <RichText
          key="settings.appearance.intro"
          params={{ system: { text: t("settings.theme.system"), tag: "strong" } }}
        />
      </p>

      <div class="seg" role="group" aria-label={t("settings.appearance.aria")}>
        {#each THEMES as entry (entry.mode)}
          <button
            class:active={theme.mode === entry.mode}
            aria-pressed={theme.mode === entry.mode}
            onclick={() => theme.set(entry.mode)}
          >
            {entry.label}
          </button>
        {/each}
      </div>
    </section>

    <section>
      <h2>{t("settings.font")}</h2>
      <p class="intro">
        <RichText
          key="settings.font.intro"
          params={{
            default: { text: t("settings.font.size", { size: 13 }), tag: "strong" },
          }}
        />
      </p>

      <div class="seg" role="group" aria-label={t("settings.font")}>
        {#each FONT_SIZES as size (size)}
          <button
            class:active={font.size === size}
            aria-pressed={font.size === size}
            onclick={() => font.set(size)}
          >
            {t("settings.font.size", { size })}
          </button>
        {/each}
      </div>
    </section>

    <!-- Tracé des lignes du graph. Chaque bouton montre son coude en petit :
         le nom seul ne dirait pas grand-chose de la différence. -->
    <section>
      <h2>{t("settings.graph")}</h2>
      <p class="intro">
        <RichText
          key="settings.graph.intro"
          params={{ rounded: { text: t("settings.graph.rounded"), tag: "strong" } }}
        />
      </p>

      <div class="seg" role="group" aria-label={t("settings.graph.aria")}>
        {#each GRAPH_LINE_STYLES as style (style)}
          <button
            class:active={graphLines.style === style}
            aria-pressed={graphLines.style === style}
            onclick={() => graphLines.set(style)}
          >
            <svg class="line-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              {#if style === "rounded"}
                <path d="M3 2v7.5a3 3 0 0 0 3 3h7" />
              {:else if style === "sharp"}
                <path d="M3 2v10.5h10" />
              {:else if style === "curve"}
                <path d="M3 2c0 7 10 5 10 12" />
              {:else}
                <path d="M3 2v4l10 8" />
              {/if}
            </svg>
            {LINE_LABELS[style]}
          </button>
        {/each}
      </div>

      <!-- Arrondi : grisé pour les deux tracés qui n'en ont pas, plutôt que
           masqué — sa place ne saute pas d'un choix à l'autre. -->
      <label class="slider" class:off={!hasRoundness(graphLines.style)}>
        <span>{t("settings.graph.roundness")}</span>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={graphLines.roundness}
          disabled={!hasRoundness(graphLines.style)}
          title={hasRoundness(graphLines.style) ? undefined : t("settings.graph.roundness.hint")}
          oninput={(e) => graphLines.setRoundness(Number(e.currentTarget.value))}
        />
        <span class="value">{graphLines.roundness} %</span>
      </label>
    </section>

    <section>
      <h2>{t("settings.profiles")}</h2>
      <p class="intro">
        <RichText
          key="settings.profiles.intro"
          params={{
            name: { text: "user.name", tag: "code" },
            email: { text: "user.email", tag: "code" },
            note: { text: t("settings.profiles.intro.note"), tag: "strong" },
          }}
        />
      </p>

      <ul class="profiles">
        {#each tabs.profiles as profile (profile.id)}
          <li class:editing={draft?.id === profile.id}>
            <div class="head">
              <div class="who">
                <span class="label">{profile.label}</span>
                <span class="ident">{profile.name} &lt;{profile.email}&gt;</span>
              </div>

              {#if confirmDelete === profile.id}
                <button class="danger" onclick={() => removeProfile(profile.id)}>
                  {t("action.confirm")}
                </button>
                <button class="ghost" onclick={() => (confirmDelete = null)}>
                  {t("action.cancel")}
                </button>
              {:else}
                <button class="ghost" onclick={() => editProfile(profile)}>
                  {t("action.edit")}
                </button>
                <button class="danger" onclick={() => (confirmDelete = profile.id)}>
                  {t("action.delete")}
                </button>
              {/if}
            </div>
          </li>
        {:else}
          <li class="empty">{t("settings.profiles.empty")}</li>
        {/each}
      </ul>

      {#if draft}
        <form
          class="draft"
          onsubmit={(e) => {
            e.preventDefault();
            saveDraft();
          }}
        >
          <label>
            {t("settings.profiles.label")}
            <input
              type="text"
              placeholder={t("settings.profiles.label.placeholder")}
              bind:value={draft.label}
            />
          </label>
          <label>
            {t("settings.profiles.name")}
            <input
              type="text"
              placeholder={t("settings.profiles.name.placeholder")}
              bind:value={draft.name}
            />
          </label>
          <label>
            {t("settings.profiles.email")}
            <input type="email" autocapitalize="off" spellcheck="false" bind:value={draft.email} />
          </label>
          <div class="actions">
            <button type="button" class="ghost" onclick={() => (draft = null)}>
              {t("action.cancel")}
            </button>
            <span class="spacer"></span>
            <button type="submit" class="primary" disabled={!draftValid || savingProfile}>
              {savingProfile ? t("action.saving") : t("action.save")}
            </button>
          </div>
        </form>
      {:else}
        <button class="ghost add-profile" onclick={newProfile}>
          {t("settings.profiles.add")}
        </button>
      {/if}
    </section>

    <section>
      <h2>{t("settings.tokens")}</h2>
      <p class="intro">
        <RichText
          key="settings.tokens.intro"
          params={{
            never: { text: t("settings.tokens.intro.never"), tag: "strong" },
            ssh: { text: "~/.ssh", tag: "code" },
            scope: { text: "repo", tag: "code" },
          }}
        />
      </p>

      {#if error}
        <p class="error">{errorMessage(error)}</p>
      {/if}

      {#if loading}
        <p class="muted">{t("common.loading")}</p>
      {:else if rows.length === 0}
        <p class="muted">{t("settings.tokens.empty")}</p>
      {/if}

      <ul class="hosts">
        {#each rows as row (row.host)}
          <li class:editing={editing === row.host}>
            <div class="head">
              <div class="who">
                <span class="host">{row.host}</span>
                {#if row.repos.length > 0}
                  <span class="repos">{row.repos.join(", ")}</span>
                {/if}
              </div>

              <span class="state" class:stored={row.stored}>
                {row.stored ? t("settings.tokens.stored") : t("settings.tokens.none")}
              </span>

              {#if editing === row.host}
                <button class="ghost" onclick={cancel}>{t("action.cancel")}</button>
              {:else}
                <button class="ghost" onclick={() => edit(row.host)}>
                  {row.stored ? t("settings.tokens.replace") : t("settings.tokens.set")}
                </button>
              {/if}
            </div>

            {#if editing === row.host}
              <form
                onsubmit={(e) => {
                  e.preventDefault();
                  save(row.host);
                }}
              >
                <label>
                  {t("settings.tokens.username")}
                  <input
                    type="text"
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck="false"
                    bind:value={username}
                  />
                </label>
                <label>
                  {t("settings.tokens.secret")}
                  <input type="password" autocomplete="off" bind:value={secret} />
                </label>

                <div class="actions">
                  {#if row.stored}
                    {#if confirmForget}
                      <button type="button" class="danger" onclick={() => forget(row.host)}>
                        {t("settings.tokens.forget.confirm")}
                      </button>
                    {:else}
                      <button type="button" class="danger" onclick={() => (confirmForget = true)}>
                        {t("settings.tokens.forget")}
                      </button>
                    {/if}
                  {/if}
                  <span class="spacer"></span>
                  <button
                    type="submit"
                    class="primary"
                    disabled={username.trim().length === 0 || secret.length === 0 || saving}
                  >
                    {saving ? t("action.saving") : t("action.save")}
                  </button>
                </div>
              </form>
            {/if}
          </li>
        {/each}
      </ul>

      <form
        class="add"
        onsubmit={(e) => {
          e.preventDefault();
          addHost();
        }}
      >
        <label>
          {t("settings.tokens.addHost")}
          <input
            type="text"
            placeholder="github.com"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            bind:value={newHost}
          />
        </label>
        <button type="submit" class="ghost" disabled={newHost.trim().length === 0}>
          {t("action.add")}
        </button>
      </form>
    </section>
  </div>
</div>

<style>
  .settings {
    height: 100%;
    overflow-y: auto;
    background: var(--bg);
  }
  .sheet {
    max-width: 680px;
    margin: 0 auto;
    padding: 1.5rem 1.5rem 3rem;
  }
  header {
    margin-bottom: 1.4rem;
  }
  h1 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
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
  /* `:global` parce que ces `<code>` sont rendus par `RichText` : le style
     scopé d'un composant ne descend pas dans un autre. */
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
    margin: 0 0 1rem;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--danger-border);
    border-radius: 6px;
    background: var(--danger-bg);
    color: var(--danger-soft);
    font-size: 0.82rem;
  }

  /* Thème et taille du texte : des options exclusives dont une est forcément
     active, donc un segmenté — pas des cases à cocher. */
  .seg {
    display: flex;
    width: fit-content;
    margin-bottom: 1.2rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .seg button {
    border: none;
    border-radius: 0;
    background: var(--bg-raised);
    color: var(--text-dim);
    padding: 0.35rem 0.9rem;
  }
  .seg button + button {
    border-left: 1px solid var(--border);
  }
  /* Arrondi des tracés du graph. */
  /* Un `label` du formulaire, mais sur une ligne : la règle générale plus bas le
     met en colonne, et donne au champ bordure et rembourrage — rien de tout ça
     ne va à un curseur. */
  .slider {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.75rem;
    margin: -0.4rem 0 1.2rem;
    font-size: 0.82rem;
    color: var(--text);
  }
  .slider input {
    width: 14rem;
    padding: 0;
    border: none;
    background: none;
    accent-color: var(--accent);
  }
  .slider .value {
    min-width: 3rem;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .slider.off {
    color: var(--text-faint);
  }
  .slider.off .value {
    color: var(--text-faint);
  }
  /* Tracés du graph : le coude dessiné devant le nom. */
  .seg button:has(.line-ic) {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .line-ic {
    flex: none;
    width: 14px;
    height: 14px;
  }
  .seg button:hover:not(.active) {
    color: var(--text);
  }
  .seg button.active {
    background: var(--accent);
    color: var(--accent-text);
  }

  .profiles,
  .hosts {
    list-style: none;
    margin: 0 0 1.2rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .profiles li,
  .hosts li {
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--bg-raised);
  }
  .profiles li.editing,
  .hosts li.editing {
    border-color: var(--accent);
  }
  .profiles li.empty {
    color: var(--text-faint);
    font-size: 0.82rem;
    border-style: dashed;
  }
  .label {
    font-size: 0.85rem;
    font-weight: 600;
  }
  .ident {
    font-family: var(--mono);
    font-size: 0.72rem;
    color: var(--text-faint);
    overflow-wrap: anywhere;
  }
  /* Le formulaire de profil n'est pas sous une ligne : pas de trait de séparation. */
  .draft {
    margin-bottom: 1.2rem;
    padding: 0.75rem;
    border: 1px solid var(--accent);
    border-radius: 7px;
    background: var(--bg-raised);
    border-top: 1px solid var(--accent);
    padding-top: 0.75rem;
  }
  .add-profile {
    margin-bottom: 1.2rem;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .who {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
    flex: 1;
  }
  .host {
    font-family: var(--mono);
    font-size: 0.82rem;
    overflow-wrap: anywhere;
  }
  .repos {
    font-size: 0.72rem;
    color: var(--text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state {
    flex: none;
    font-size: 0.72rem;
    color: var(--text-faint);
  }
  .state.stored {
    color: var(--ok-soft);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.76rem;
    color: var(--text-dim);
  }
  input {
    padding: 0.38rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg);
    color: var(--text);
    font-size: 0.84rem;
    font-family: inherit;
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
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
    background: var(--accent);
    color: var(--accent-text);
  }
  .danger {
    background: transparent;
    border-color: var(--danger-border);
    color: var(--danger-soft);
  }
  .danger:hover {
    background: var(--danger-bg);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* Ajout d'un hôte : le champ et le bouton sur une même ligne. */
  .add {
    flex-direction: row;
    align-items: flex-end;
    border-top: none;
    padding-top: 0;
  }
  .add label {
    flex: 1;
  }
</style>

<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { tabs } from "../stores/repo.svelte";
  import { theme } from "../theme.svelte";
  import type { AppError, Profile, ThemeMode } from "../types";

  /** Les trois thèmes proposés, dans l'ordre d'affichage du segmenté. */
  const THEMES: { mode: ThemeMode; label: string }[] = [
    { mode: "light", label: "Clair" },
    { mode: "dark", label: "Sombre" },
    { mode: "system", label: "Système" },
  ];

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
    for (const tab of tabs.tabs) {
      try {
        const remote = await api.getRemoteInfo(tab.repoId);
        // Un distant SSH n'a que faire d'un jeton : le lister inviterait à en
        // saisir un qui ne servirait jamais.
        if (!remote.host || !remote.usesHttp) continue;
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

<svelte:window
  onkeydown={(e) => (e.key === "Escape" ? tabs.closeSettings() : undefined)}
/>

<div class="settings">
  <div class="sheet">
    <header>
      <h1>Paramètres</h1>
      <button class="close" title="Fermer" aria-label="Fermer" onclick={() => tabs.closeSettings()}>
        ×
      </button>
    </header>

    <section>
      <h2>Apparence</h2>
      <p class="intro">
        Le thème s'applique à toute l'application. <strong>Système</strong> suit
        l'apparence du système et bascule avec elle, même pendant que GitLite
        tourne.
      </p>

      <div class="seg" role="group" aria-label="Thème de l'interface">
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
      <h2>Profils</h2>
      <p class="intro">
        Un profil est une identité d'auteur : un nom et une adresse. Le choisir
        pour un dépôt écrit <code>user.name</code> et <code>user.email</code> dans
        sa configuration locale — les commits faits hors de GitLite l'utilisent
        donc aussi. Le choix se fait dans la boîte de commit, à droite.
        <strong>Supprimer un profil ne change rien aux dépôts qui l'utilisaient</strong>,
        leur identité vivant dans leur propre configuration.
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
                  Confirmer
                </button>
                <button class="ghost" onclick={() => (confirmDelete = null)}>Annuler</button>
              {:else}
                <button class="ghost" onclick={() => editProfile(profile)}>Modifier</button>
                <button class="danger" onclick={() => (confirmDelete = profile.id)}>
                  Supprimer
                </button>
              {/if}
            </div>
          </li>
        {:else}
          <li class="empty">Aucun profil pour l'instant.</li>
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
            Libellé
            <input type="text" placeholder="Perso" bind:value={draft.label} />
          </label>
          <label>
            Nom
            <input type="text" placeholder="Prénom Nom" bind:value={draft.name} />
          </label>
          <label>
            Adresse e-mail
            <input type="email" autocapitalize="off" spellcheck="false" bind:value={draft.email} />
          </label>
          <div class="actions">
            <button type="button" class="ghost" onclick={() => (draft = null)}>Annuler</button>
            <span class="spacer"></span>
            <button type="submit" class="primary" disabled={!draftValid || savingProfile}>
              {savingProfile ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      {:else}
        <button class="ghost add-profile" onclick={newProfile}>Ajouter un profil</button>
      {/if}
    </section>

    <section>
      <h2>Jetons d'accès</h2>
      <p class="intro">
        Un jeton par hôte, utilisé pour les dépôts en HTTPS. GitLite le conserve
        dans le trousseau du système et ne le partage avec aucun autre outil.
        <strong>Il n'est jamais réaffiché</strong> : le modifier consiste à en
        saisir un nouveau. Les dépôts en SSH ne sont pas listés : ils
        s'authentifient par une clé, via l'agent ou depuis <code>~/.ssh</code>.
      </p>

      {#if error}
        <p class="error">{error.message}</p>
      {/if}

      {#if loading}
        <p class="muted">Chargement…</p>
      {:else if rows.length === 0}
        <p class="muted">
          Aucun dépôt distant en HTTPS parmi les onglets ouverts. Ajoute un hôte
          ci-dessous pour préparer un jeton à l'avance.
        </p>
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
                {row.stored ? "Jeton enregistré" : "Aucun jeton"}
              </span>

              {#if editing === row.host}
                <button class="ghost" onclick={cancel}>Annuler</button>
              {:else}
                <button class="ghost" onclick={() => edit(row.host)}>
                  {row.stored ? "Modifier" : "Renseigner"}
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
                  Identifiant
                  <input
                    type="text"
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck="false"
                    bind:value={username}
                  />
                </label>
                <label>
                  Jeton d'accès
                  <input type="password" autocomplete="off" bind:value={secret} />
                </label>

                <div class="actions">
                  {#if row.stored}
                    {#if confirmForget}
                      <button type="button" class="danger" onclick={() => forget(row.host)}>
                        Confirmer l'oubli
                      </button>
                    {:else}
                      <button type="button" class="danger" onclick={() => (confirmForget = true)}>
                        Oublier
                      </button>
                    {/if}
                  {/if}
                  <span class="spacer"></span>
                  <button
                    type="submit"
                    class="primary"
                    disabled={username.trim().length === 0 || secret.length === 0 || saving}
                  >
                    {saving ? "Enregistrement…" : "Enregistrer"}
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
          Ajouter un hôte
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
          Ajouter
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.4rem;
  }
  h1 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
  }
  .close {
    width: 28px;
    height: 28px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--text-dim);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
  }
  .close:hover {
    color: var(--text);
    background: var(--bg-raised);
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
  .intro code {
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

  /* Choix du thème : trois options exclusives dont une est forcément active,
     donc un segmenté — pas trois cases à cocher. */
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

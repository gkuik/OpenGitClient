<script lang="ts">
  import { repo } from "../stores/repo.svelte";

  // Le dialogue n'est monté que lorsqu'une demande est en cours (voir App.svelte),
  // mais on relit l'onglet actif à chaque rendu : changer d'onglet doit changer
  // de demande, pas figer celle du départ.
  const prompt = $derived(repo.credentialsPrompt);

  let username = $state("");
  let secret = $state("");

  // Repartir d'un formulaire vide dès que la demande change d'hôte : un secret
  // saisi pour un serveur ne doit jamais se retrouver proposé pour un autre.
  let lastHost = $state<string | null>(null);
  $effect(() => {
    const host = prompt?.remote.host ?? null;
    if (host !== lastHost) {
      lastHost = host;
      username = "";
      secret = "";
    }
  });

  const canSubmit = $derived(
    username.trim().length > 0 && secret.length > 0 && !repo.savingCredentials,
  );

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    repo.saveCredentials(username.trim(), secret);
    // Ne pas garder le secret en mémoire une fois transmis.
    secret = "";
  }

  function cancel() {
    secret = "";
    repo.cancelCredentials();
  }
</script>

<svelte:window onkeydown={(e) => (e.key === "Escape" ? cancel() : undefined)} />

{#if prompt}
  <!-- Fond assombri : cliquer à côté referme, comme le menu des stashes. -->
  <button class="scrim" aria-label="Annuler" onclick={cancel}></button>

  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="cred-title">
    <h2 id="cred-title">Identifiants pour {prompt.remote.host}</h2>

    {#if prompt.refused}
      <p class="note warn">
        Les identifiants enregistrés ont été refusés par le serveur. Saisis-les à
        nouveau — un jeton d'accès a pu expirer.
      </p>
    {:else}
      <p class="note">
        Aucun identifiant enregistré pour cet hôte. GitLite les conserve dans le
        trousseau du système et ne les partage avec aucun autre outil.
      </p>
    {/if}

    <p class="url">{prompt.remote.url}</p>

    <form onsubmit={submit}>
      <label>
        Identifiant
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          autofocus
          bind:value={username}
        />
      </label>

      <label>
        Mot de passe ou jeton d'accès
        <input type="password" autocomplete="off" bind:value={secret} />
      </label>

      <div class="actions">
        <button type="button" class="ghost" onclick={cancel}>Annuler</button>
        <button type="submit" class="primary" disabled={!canSubmit}>
          {repo.savingCredentials ? "Enregistrement…" : "Enregistrer et réessayer"}
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
    margin: 0 0 0.5rem;
    font-size: 0.95rem;
    font-weight: 600;
  }
  .note {
    margin: 0 0 0.6rem;
    font-size: 0.8rem;
    line-height: 1.4;
    color: var(--text-dim);
  }
  .note.warn {
    color: var(--danger-soft);
  }
  .url {
    margin: 0 0 0.9rem;
    font-family: var(--mono);
    font-size: 0.72rem;
    color: var(--text-faint);
    overflow-wrap: anywhere;
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
  input {
    padding: 0.4rem 0.5rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text);
    font-size: 0.85rem;
    font-family: inherit;
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
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

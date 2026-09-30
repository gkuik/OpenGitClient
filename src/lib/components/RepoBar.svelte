<script lang="ts">
  /*
    Barre du dépôt, sous la barre d'onglets : le nom du dépôt à gauche, les
    actions distantes au centre, le compte rendu de la dernière à droite.

    Elle a quitté la colonne des branches, où elle coiffait les sections : Pull,
    Push et Fetch concernent le **dépôt**, pas la liste des branches, et rien ne
    justifiait qu'ils prennent la largeur d'une colonne latérale. Les sections y
    ont gagné la hauteur correspondante.

    Le centrage est celui d'une grille `1fr auto 1fr`, jamais un `justify-content`
    sur une rangée : les boutons restent au milieu de la **fenêtre** quels que
    soient la longueur du nom et celle du message, alors qu'un centrage par
    répartition les décalerait dès que l'un des deux grandit.
  */
  import type { Snippet } from "svelte";
  import { t } from "../i18n.svelte";
  import { repo, tabs, type Outcome, type RemoteOp } from "../stores/repo.svelte";
  import type { PullMode, PushMode } from "../types";

  // ── Menu du bouton Pull ─────────────────────────────────────────────────────
  // L'entrée « rebase » est là pour dire ce qui existera, mais désactivée : il
  // n'y a pas de mode correspondant côté backend, donc rien à envoyer.
  const PULL_ENTRIES: { mode: PullMode | null; label: string; hint: string }[] = $derived([
    {
      mode: "fetchAll",
      label: t("toolbar.pull.fetchAll"),
      hint: t("toolbar.pull.fetchAll.hint"),
    },
    {
      mode: "fastForwardOrMerge",
      label: t("toolbar.pull.fastForwardOrMerge"),
      hint: t("toolbar.pull.fastForwardOrMerge.hint"),
    },
    {
      mode: "fastForwardOnly",
      label: t("toolbar.pull.fastForwardOnly"),
      hint: t("toolbar.pull.fastForwardOnly.hint"),
    },
    {
      mode: null,
      label: t("toolbar.pull.rebase"),
      hint: t("toolbar.pull.rebase.hint"),
    },
  ]);

  const currentPull = $derived(
    PULL_ENTRIES.find((e) => e.mode === tabs.pullMode) ?? PULL_ENTRIES[1],
  );

  /** Position du menu du bouton Pull, en coordonnées fenêtre. */
  let pullMenu = $state<{ x: number; y: number } | null>(null);
  const PULL_MENU_W = 268;
  const PULL_MENU_H = 168;

  /** Ouvre le menu au point demandé, entièrement ramené dans la fenêtre. */
  function openPullMenu(x: number, y: number) {
    pullMenu = {
      x: Math.max(8, Math.min(x, window.innerWidth - PULL_MENU_W - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - PULL_MENU_H - 8)),
    };
  }

  function choosePull(mode: PullMode) {
    pullMenu = null;
    // Choisir ne déclenche rien : le menu fixe ce que **le bouton** fera.
    void tabs.setPullMode(mode);
  }

  // ── Menu du bouton Push ─────────────────────────────────────────────────────
  //
  // Ce menu ne ressemble pas à celui du Pull, et c'est voulu : celui-ci ne
  // choisit pas ce que le bouton fera plus tard, il **agit**. Un mode de force
  // retenu d'une fois sur l'autre ferait du bouton Push un piège ; ici il est
  // choisi au coup par coup et retombe aussitôt.
  //
  // D'où aussi la confirmation en deux temps, comme la suppression d'un stash :
  // aucune capacité de dialogue natif n'est déclarée, et c'est la seule action
  // de l'application qui puisse retirer des commits d'un serveur.
  let pushMenu = $state<{ x: number; y: number } | null>(null);
  /** Entrée armée : le second clic l'exécute. */
  let confirmPush = $state<PushMode | null>(null);
  const PUSH_MENU_W = 300;
  const PUSH_MENU_H = 132;

  function openPushMenu(x: number, y: number) {
    pushMenu = {
      x: Math.max(8, Math.min(x, window.innerWidth - PUSH_MENU_W - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - PUSH_MENU_H - 8)),
    };
    confirmPush = null;
  }

  function forcePush(mode: PushMode) {
    if (confirmPush !== mode) {
      confirmPush = mode;
      return;
    }
    pushMenu = null;
    confirmPush = null;
    void repo.push(mode);
  }

  /*
    Le dépôt n'est pas encore chargé le temps d'un aller-retour à l'ouverture
    d'un onglet. La barre reste en place — sa hauteur ne doit pas sauter — mais
    ses actions sont indisponibles, au même titre qu'avec une opération déjà en
    cours : elles n'auraient aucun `repoId` valide à envoyer.
  */
  const unavailable = $derived(repo.busyRemote || !repo.repoInfo);

  /**
   * Couleur du compte rendu : l'issue de la dernière opération. Pendant qu'une
   * opération tourne, le texte reste neutre — c'est le bouton et la barre de
   * progression qui travaillent.
   */
  const tone = $derived(repo.runningOp || repo.mergingBranches ? null : repo.opTone);

  /** Compte rendu de la dernière opération distante, ou de la fusion en cours. */
  const status = $derived(
    repo.fetching
      ? t("toolbar.status.fetching")
      : repo.pushing
        ? t("toolbar.status.pushing")
        : repo.pulling
          ? t("toolbar.status.pulling")
          : repo.pushingTag
            ? t("toolbar.status.pushingTag")
            : repo.mergingBranches
              ? t("toolbar.status.merging")
              : repo.opStatus,
  );
</script>

<!-- Échap referme les deux menus, comme ceux de la colonne des branches. -->
<svelte:window
  onkeydown={(e) => {
    if (e.key !== "Escape") return;
    pullMenu = null;
    pushMenu = null;
    confirmPush = null;
  }}
/>

<div class="repobar">
  <!-- Barre de progression indéterminée, juste sous le filet du bas : visible
       où qu'on regarde dans la fenêtre, tant qu'une opération distante — ou
       une fusion — tourne. Toujours dans le DOM, pour que son apparition et sa
       disparition se fassent en fondu plutôt qu'en saut. -->
  <div
    class="progress"
    class:on={repo.busyRemote || repo.mergingBranches}
    aria-hidden="true"
  ></div>

  <span class="name" title={repo.repoId}>{repo.repoInfo?.name ?? "…"}</span>

  <div class="actions">
    {@render action({
      label: "Pull",
      op: "pull",
      icon: pullIcon,
      hint: currentPull.hint,
      run: currentPull.mode ? () => repo.pull(currentPull.mode!) : undefined,
      busy: unavailable,
      count: repo.currentGap?.behind,
      menu: { open: openPullMenu, hint: t("toolbar.pull.menu.hint") },
    })}
    {@render action({
      label: t("toolbar.push"),
      op: "push",
      icon: pushIcon,
      hint: t("toolbar.push.hint"),
      run: () => repo.push(),
      busy: unavailable,
      count: repo.currentGap?.ahead,
      menu: { open: openPushMenu, hint: t("toolbar.push.menu.hint") },
    })}
    {@render action({
      label: t("toolbar.fetch"),
      op: "fetch",
      icon: fetchIcon,
      hint: t("toolbar.fetch.hint"),
      run: () => repo.fetch(),
      busy: unavailable,
    })}
    <!-- Les trois boutons de gauche parlent au distant ; celui-ci reste local.
         Un filet les sépare pour le dire. -->
    <span class="group-sep" aria-hidden="true"></span>
    {@render action({
      label: t("toolbar.branch"),
      icon: branchIcon,
      hint: t("toolbar.branch.hint"),
      run: () => repo.askBranch(),
      // Il faut un commit où poser la branche (pas de HEAD non né), et rien
      // qui écrive déjà le working directory.
      busy: !repo.repoInfo?.head || repo.checkingOut || repo.busy || repo.mergingBranches,
    })}
    {@render action({
      label: t("toolbar.stash"),
      icon: stashIcon,
      hint: repo.changeCount === 0 ? t("toolbar.stash.nothing") : t("toolbar.stash.hint"),
      run: () => repo.quickStash(),
      // Rien à remiser, ou quelque chose écrit déjà le working directory.
      busy:
        repo.changeCount === 0 ||
        repo.stashing ||
        repo.checkingOut ||
        repo.busy ||
        repo.mergingBranches ||
        !repo.repoInfo,
    })}
  </div>

  <!-- Compte rendu partagé par les trois : le backend ne laisse pas un fetch et
       un push se croiser sur un même dépôt. Sans lui, un fetch qui ne ramène
       rien n'aurait aucun effet visible, la section REMOTE restant identique.
       Le `<p>` est là même vide : `aria-live` n'annonce que ce qui change dans
       un élément déjà présent. -->
  <!-- La couleur dit l'issue (vert : quelque chose a bougé, gris : rien à
       faire, ambre : à regarder) ; pendant l'opération, le texte reste neutre,
       c'est le bouton et la barre qui travaillent. -->
  <p
    class="status"
    class:ok={tone === "ok"}
    class:warn={tone === "warn"}
    aria-live="polite"
    title={status ?? ""}
  >
    {#if status && tone === "ok"}
      {@render outcomeIcon("ok", "status-ic")}
    {:else if status && tone === "warn"}
      {@render outcomeIcon("warn", "status-ic")}
    {/if}
    <span class="status-text">{status ?? ""}</span>
  </p>
</div>

<!-- Menu du bouton Pull : superposition qui referme, position en coordonnées
     fenêtre, Échap — la même mécanique que les menus de la colonne de gauche. -->
{#if pullMenu}
  <button
    class="ctx-overlay"
    aria-label={t("common.closeMenu")}
    onclick={() => (pullMenu = null)}
    oncontextmenu={(e) => {
      e.preventDefault();
      pullMenu = null;
    }}
  ></button>
  <div
    class="ctx-menu pull-menu"
    style="left: {pullMenu.x}px; top: {pullMenu.y}px"
    role="menu"
  >
    <p class="ctx-head">{t("toolbar.pull.menu")}</p>
    {#each PULL_ENTRIES as entry (entry.label)}
      {@const selected = entry.mode !== null && entry.mode === tabs.pullMode}
      <button
        class="ctx-item"
        class:selected
        role="menuitemradio"
        aria-checked={selected}
        disabled={entry.mode === null}
        title={entry.hint}
        onclick={() => entry.mode && choosePull(entry.mode)}
      >
        <span class="radio">{selected ? "◉" : "○"}</span>
        <span>{entry.label}</span>
      </button>
    {/each}
  </div>
{/if}

<!--
  Menu du bouton Push. Deux entrées, deux façons de réécrire la branche
  distante — et une seule des deux regarde avant d'écrire.

  Elles sont désactivées pendant une opération distante : contrairement au menu
  du Pull, qui ne fait que retenir un choix, celles-ci partent sur le réseau.
-->
{#if pushMenu}
  <button
    class="ctx-overlay"
    aria-label={t("common.closeMenu")}
    onclick={() => {
      pushMenu = null;
      confirmPush = null;
    }}
    oncontextmenu={(e) => {
      e.preventDefault();
      pushMenu = null;
      confirmPush = null;
    }}
  ></button>
  <div
    class="ctx-menu push-menu"
    style="left: {pushMenu.x}px; top: {pushMenu.y}px"
    role="menu"
  >
    <p class="ctx-head">{t("toolbar.push.menu")}</p>
    <button
      class="ctx-item wrap danger"
      role="menuitem"
      disabled={unavailable}
      title={t("toolbar.push.lease.hint")}
      onclick={() => forcePush("forceWithLease")}
    >
      {@render leaseIcon()}
      <span>
        {confirmPush === "forceWithLease"
          ? t("toolbar.push.lease.confirm")
          : t("toolbar.push.lease")}
      </span>
    </button>
    <button
      class="ctx-item wrap danger"
      role="menuitem"
      disabled={unavailable}
      title={t("toolbar.push.force.hint")}
      onclick={() => forcePush("force")}
    >
      {@render forceIcon()}
      <span>
        {confirmPush === "force" ? t("toolbar.push.force.confirm") : t("toolbar.push.force")}
      </span>
    </button>
  </div>
{/if}

<!-- La flèche du push, avec une coche : on n'écrase que ce qu'on a vérifié. -->
{#snippet leaseIcon()}
  <svg class="ctx-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6 12.5v-7" />
    <path d="M3.5 8 6 5.5 8.5 8" />
    <path d="M1.5 2.75h9" />
    <path d="M10.5 11.5 12 13l2.5-3" />
  </svg>
{/snippet}

<!-- La même flèche, avec un point d'exclamation : rien n'est vérifié. -->
{#snippet forceIcon()}
  <svg class="ctx-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6 12.5v-7" />
    <path d="M3.5 8 6 5.5 8.5 8" />
    <path d="M1.5 2.75h9" />
    <path d="M12.5 9v2.5" />
    <path d="M12.5 13.6v.01" />
  </svg>
{/snippet}

<!--
  Un bouton de la barre : icône au-dessus du libellé.

  Un bouton sans `run` est désactivé plutôt qu'absent : la place de la commande
  reste acquise. `count` est l'écart de la branche courante avec son amont — ce
  que le bouton traiterait. Zéro et « pas d'amont » ne mettent pas de pastille :
  elle signale du travail en attente, pas une synchronisation vérifiée.

  `menu` fait du bouton un bouton à menu : au clic droit, comme les stashes et
  les branches de la colonne de gauche. Il n'y a donc plus rien à voir dessus —
  d'où la seconde ligne d'infobulle, seul endroit qui puisse encore annoncer le
  menu maintenant que la flèche a disparu.
-->
{#snippet action(a: {
  label: string;
  /**
   * L'opération distante que le bouton lance : c'est elle qu'il anime, et elle
   * seule. Absente pour un bouton local (Branch).
   */
  op?: RemoteOp;
  icon: Snippet;
  hint: string;
  run?: () => void;
  busy?: boolean;
  count?: number;
  /** Menu du bouton : son infobulle, et son ouverture en coordonnées fenêtre. */
  menu?: { hint: string; open: (x: number, y: number) => void };
})}
  {@const disabled = !a.run || a.busy}
  {@const running = a.op !== undefined && repo.runningOp === a.op}
  {@const flash = a.op !== undefined && repo.flash?.op === a.op ? repo.flash.outcome : null}
  {@const hint = a.run ? a.hint : `${a.hint} (${t("common.notAvailable")})`}
  <!--
    Le cadre porte l'infobulle et le clic droit ; le bouton ne porte que
    l'action. Ce partage n'est pas cosmétique : WebKit n'émet aucun événement de
    souris sur un `<button>` désactivé, or Pull l'est pendant l'opération
    distante — c'est-à-dire exactement quand on veut choisir ce qu'il fera
    ensuite. Le bouton désactivé passe en `pointer-events: none` et le clic
    tombe sur le cadre, qui l'attend.
  -->
  <!-- Le cadre n'est pas un widget : c'est le bouton qu'il enferme qui en est
       un, et l'équivalent clavier du menu est sur lui (touche Menu). L'avertis-
       sement vise le cas général d'un élément inerte rendu interactif. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="split"
    class:disabled={disabled && !running}
    class:running
    class:flash-ok={flash === "ok"}
    class:flash-neutral={flash === "neutral"}
    class:flash-warn={flash === "warn"}
    class:flash-danger={flash === "danger"}
    title={a.menu ? `${hint}\n${a.menu.hint}` : hint}
    oncontextmenu={a.menu
      ? (e) => {
          e.preventDefault();
          a.menu!.open(e.clientX, e.clientY);
        }
      : undefined}
  >
    <button
      class="action"
      class:running
      data-op={a.op}
      {disabled}
      aria-busy={running}
      aria-haspopup={a.menu ? "menu" : undefined}
      onclick={a.run}
      onkeydown={a.menu
        ? (e) => {
            // Équivalent clavier du clic droit, comme sur une ligne de stash.
            if (e.key !== "ContextMenu") return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            a.menu!.open(r.left, r.bottom + 2);
          }
        : undefined}
    >
      <!-- L'éclair de fin remplace l'icône le temps de `FLASH_MS` ; `#key`
           rejoue son apparition si deux opérations s'enchaînent. -->
      {#key repo.flash}
        {#if flash}
          {@render outcomeIcon(flash, "action-ic flash-ic")}
        {:else}
          {@render a.icon()}
        {/if}
      {/key}
      <span>{a.label}</span>
      {#if a.count}
        <span class="badge">{a.count}</span>
      {/if}
    </button>
  </div>
{/snippet}

<!-- Issue d'une opération : coche (fait, ou rien à faire), point d'exclamation
     (à regarder), croix (échec). Partagé par l'éclair du bouton et le compte
     rendu. -->
{#snippet outcomeIcon(outcome: Outcome, cls: string)}
  <svg class={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if outcome === "danger"}
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    {:else if outcome === "warn"}
      <path d="M8 3.5v5.5" />
      <path d="M8 12.25v.25" />
    {:else}
      <path d="M3.5 8.5l3 3 6-7" />
    {/if}
  </svg>
{/snippet}

{#snippet pullIcon()}
  <!-- Flèche descendante vers une base : le distant vient jusqu'au local. -->
  <svg class="action-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 1.75v7.5" />
    <path d="M4.75 6 8 9.25 11.25 6" />
    <path d="M3 13.25h10" />
  </svg>
{/snippet}

{#snippet branchIcon()}
  <!-- Une branche qui se détache d'une ligne : celle de la sidebar, agrandie. -->
  <svg class="action-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="4.5" cy="3.5" r="1.75" />
    <circle cx="4.5" cy="12.5" r="1.75" />
    <circle cx="11.5" cy="5" r="1.75" />
    <path d="M4.5 5.25v5.5" />
    <path d="M9.75 6.4A5 5 0 0 1 6.2 11.9" />
  </svg>
{/snippet}

{#snippet stashIcon()}
  <!-- Le bac de rangement de la section STASHES, agrandi. -->
  <svg class="action-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
    <path d="M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" />
    <path d="M1.5 8.75h3.2l1 1.6h4.6l1-1.6h3.2" stroke-linecap="round" />
  </svg>
{/snippet}

{#snippet fetchIcon()}
  <!-- Flèche circulaire : rapatrie les références sans toucher au working dir. -->
  <svg class="action-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M13.4 9.2A5.5 5.5 0 1 1 12 4.2" />
    <path d="M9.4 4.6 12 4.2l-.4-2.6" />
  </svg>
{/snippet}

{#snippet pushIcon()}
  <!-- Flèche montante depuis une base : le local part vers le distant. -->
  <svg class="action-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 14.25v-7.5" />
    <path d="M4.75 10 8 6.75 11.25 10" />
    <path d="M3 2.75h10" />
  </svg>
{/snippet}

<style>
  /*
    Trois cellules : nom · actions · compte rendu. Les deux colonnes latérales
    valent `1fr` chacune, ce qui pose les actions exactement au milieu de la
    fenêtre — c'est la seule façon de ne pas les voir glisser quand le nom du
    dépôt ou le message s'allonge.
  */
  .repobar {
    /* Ancre la barre de progression. */
    position: relative;
    flex: none;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 0.75rem;
    /* Aucun rembourrage vertical : la barre fait exactement la hauteur des
       boutons (48px, plus son filet). Sa hauteur est donc celle du contrôle le
       plus haut qu'elle porte, et le nom comme le compte rendu se centrent
       dessus. */
    padding: 0 0.75rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  .name {
    min-width: 0;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  /* Filet entre les actions distantes et les locales. */
  .group-sep {
    flex: none;
    width: 1px;
    height: 28px;
    margin: 0 0.3rem;
    background: var(--border);
  }
  /* Compte rendu de la dernière opération ; s'efface tout seul. Un peu plus
     grand qu'avant, et coloré selon l'issue : en 0.72rem gris, un compte rendu
     de fin passait inaperçu. */
  .status {
    margin: 0;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.35rem;
    font-size: 0.78rem;
    color: var(--text-dim);
  }
  .status.ok {
    color: var(--ok);
  }
  .status.warn {
    color: var(--warn);
  }
  .status-text {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status-ic {
    flex: none;
    width: 14px;
    height: 14px;
  }

  /*
    Barre de progression : 2px sous le filet du bas, un segment qui glisse de
    gauche à droite. Indéterminée — le backend ne remonte pas (encore) de
    progression chiffrée —, elle ne dit que « ça travaille », mais le dit
    partout à la fois.
  */
  /* Accrochée **sous** le filet (`top: 100%` : juste après la bordure, qui
     fait partie de la boîte), elle mord donc sur le haut des trois colonnes —
     d'où le `z-index`, au-dessus du graph (canvas 3, en-tête 4, copie de
     pastille 6) mais sous les menus (50). */
  .progress {
    position: absolute;
    left: 0;
    right: 0;
    top: 100%;
    z-index: 10;
    height: 2px;
    overflow: hidden;
    pointer-events: none;
    opacity: 0;
    transition: opacity 200ms ease;
  }
  .progress.on {
    opacity: 1;
  }
  .progress::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    width: 30%;
    background: var(--accent);
    border-radius: 1px;
    animation: progress-slide 1.2s ease-in-out infinite;
  }
  /* Invisible, la barre n'a pas à calculer d'animation. */
  .progress:not(.on)::before {
    animation: none;
  }
  @keyframes progress-slide {
    from {
      left: -30%;
    }
    to {
      left: 100%;
    }
  }
  /* Le cadre du bouton : il porte le fond et le survol, et reçoit le clic droit
     à la place du bouton quand celui-ci est désactivé. Plat — ni bordure ni
     coins arrondis : seul le fond dit l'état (survol, en cours, issue). */
  .split {
    position: relative;
    flex: none;
    display: flex;
    align-items: stretch;
  }
  /* Ni le bouton en cours ni celui qui affiche son issue ne prennent le survol :
     leur couleur dit quelque chose, le survol l'effacerait. */
  .split:hover:not(.disabled):not(.running):not([class*="flash-"]) {
    background: var(--bg-raised);
  }
  /* Boutons carrés, icône au-dessus du libellé. `relative` pour ancrer la
     pastille de compteur dans le coin. */
  .action {
    position: relative;
    flex: none;
    width: 48px;
    height: 48px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 0;
    color: var(--text);
    font-size: 0.7rem;
    cursor: pointer;
  }
  .action:disabled {
    color: var(--text-faint);
    cursor: default;
    /* Laisse passer le clic droit jusqu'au cadre : voir la note du balisage. */
    pointer-events: none;
  }
  .action-ic {
    width: 20px;
    height: 20px;
  }

  /*
    Le bouton qui a lancé l'opération reste allumé pendant qu'elle tourne —
    fond d'accent — alors que les deux autres se grisent : c'est ce
    qui dit *laquelle* est en cours. Il reste désactivé (un second clic
    n'aurait rien à faire), d'où la couleur reprise sur `:disabled`.
  */
  .split.running {
    background: var(--accent-bg);
  }
  .action.running:disabled {
    color: var(--accent-soft);
  }
  /* Et son icône bouge, dans le sens de ce qu'elle fait : la flèche du fetch
     tourne, celle du pull descend, celle du push monte. */
  .action.running[data-op="fetch"] .action-ic {
    animation: spin 1s linear infinite;
  }
  .action.running[data-op="pull"] .action-ic {
    animation: bob-down 0.9s ease-in-out infinite;
  }
  .action.running[data-op="push"] .action-ic {
    animation: bob-up 0.9s ease-in-out infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes bob-down {
    50% {
      transform: translateY(3px);
    }
  }
  @keyframes bob-up {
    50% {
      transform: translateY(-3px);
    }
  }

  /* Éclair de fin : l'icône d'issue, et le fond teinté de sa couleur — sauf
     « rien à faire », que la coche seule suffit à dire. */
  .split.flash-ok {
    background: var(--ok-bg);
  }
  .split.flash-warn {
    background: var(--warn-bg);
  }
  .split.flash-danger {
    background: var(--danger-bg);
  }
  .split.flash-ok .action,
  .split.flash-neutral .action {
    color: var(--ok);
  }
  .split.flash-warn .action {
    color: var(--warn);
  }
  .split.flash-danger .action {
    color: var(--danger);
  }
  .split[class*="flash-"] {
    transition: background 400ms ease;
  }
  .flash-ic {
    animation: pop 220ms ease-out;
  }
  @keyframes pop {
    from {
      transform: scale(0.4);
      opacity: 0;
    }
  }

  /* Qui a demandé moins de mouvement garde les couleurs, pas les animations :
     la barre reste pleine plutôt que de glisser. */
  @media (prefers-reduced-motion: reduce) {
    .action.running .action-ic,
    .flash-ic {
      animation: none !important;
    }
    .progress::before {
      animation: none;
      left: 0;
      width: 100%;
      opacity: 0.6;
    }
  }
  /* Compteur d'écart. Sa couleur est fixée ici, sinon il hériterait du gris de
     `.action:disabled` — Pull et Push étant justement désactivés. */
  .badge {
    position: absolute;
    top: 4px;
    right: 4px;
    min-width: 1rem;
    padding: 0 0.2rem;
    border-radius: 999px;
    background: var(--accent-bg);
    color: var(--accent-soft);
    font-size: 0.62rem;
    font-variant-numeric: tabular-nums;
    line-height: 1.4;
  }

  /* Menu du bouton Push : les libellés de confirmation sont longs, l'entrée se
     replie donc au lieu d'étirer le menu hors de l'écran. */
  .push-menu {
    min-width: 260px;
    max-width: 300px;
  }
  .ctx-item.wrap {
    white-space: normal;
    align-items: flex-start;
    line-height: 1.35;
  }
  /* L'icône garde l'axe de la première ligne quand le texte se replie. */
  .ctx-item.wrap .ctx-ic {
    margin-top: 0.1rem;
  }
  .ctx-ic {
    flex: none;
    width: 14px;
    height: 14px;
  }
  /* Réécrire une branche distante n'est pas une action ordinaire : elle se
     signale comme la suppression d'un stash. */
  .ctx-item.danger {
    color: var(--danger);
  }
  .ctx-item.danger:hover:not(:disabled) {
    background: var(--danger-bg);
  }

  /* Menu du bouton Pull : le chrome commun est dans `app.css`, ne reste ici que
     ce qui lui est propre — sa largeur et ses puces radio. */
  .pull-menu {
    min-width: 268px;
  }
  .radio {
    flex: none;
    width: 0.9rem;
    font-size: 0.7rem;
    color: var(--text-faint);
  }
  .ctx-item.selected {
    background: var(--accent-bg);
  }
  .ctx-item.selected .radio {
    color: var(--accent-soft);
  }
</style>

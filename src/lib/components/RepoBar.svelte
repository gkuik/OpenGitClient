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
  import { repo, tabs } from "../stores/repo.svelte";
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
  <span class="name" title={repo.repoId}>{repo.repoInfo?.name ?? "…"}</span>

  <div class="actions">
    {@render action({
      label: "Pull",
      icon: pullIcon,
      hint: currentPull.hint,
      run: currentPull.mode ? () => repo.pull(currentPull.mode!) : undefined,
      busy: unavailable,
      count: repo.currentGap?.behind,
      menu: { open: openPullMenu, hint: t("toolbar.pull.menu.hint") },
    })}
    {@render action({
      label: t("toolbar.push"),
      icon: pushIcon,
      hint: t("toolbar.push.hint"),
      run: () => repo.push(),
      busy: unavailable,
      count: repo.currentGap?.ahead,
      menu: { open: openPushMenu, hint: t("toolbar.push.menu.hint") },
    })}
    {@render action({
      label: t("toolbar.fetch"),
      icon: fetchIcon,
      hint: t("toolbar.fetch.hint"),
      run: () => repo.fetch(),
      busy: unavailable,
    })}
  </div>

  <!-- Compte rendu partagé par les trois : le backend ne laisse pas un fetch et
       un push se croiser sur un même dépôt. Sans lui, un fetch qui ne ramène
       rien n'aurait aucun effet visible, la section REMOTE restant identique.
       Le `<p>` est là même vide : `aria-live` n'annonce que ce qui change dans
       un élément déjà présent. -->
  <p class="status" aria-live="polite" title={status ?? ""}>{status ?? ""}</p>
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
  icon: Snippet;
  hint: string;
  run?: () => void;
  busy?: boolean;
  count?: number;
  /** Menu du bouton : son infobulle, et son ouverture en coordonnées fenêtre. */
  menu?: { hint: string; open: (x: number, y: number) => void };
})}
  {@const disabled = !a.run || a.busy}
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
    class:disabled
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
      {disabled}
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
      {@render a.icon()}
      <span>{a.label}</span>
      {#if a.count}
        <span class="badge">{a.count}</span>
      {/if}
    </button>
  </div>
{/snippet}

{#snippet pullIcon()}
  <!-- Flèche descendante vers une base : le distant vient jusqu'au local. -->
  <svg class="action-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 1.75v7.5" />
    <path d="M4.75 6 8 9.25 11.25 6" />
    <path d="M3 13.25h10" />
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
    gap: 0.4rem;
  }
  /* Compte rendu de la dernière opération ; s'efface tout seul. */
  .status {
    margin: 0;
    min-width: 0;
    font-size: 0.72rem;
    color: var(--text-dim);
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Le cadre du bouton : il porte le fond, la bordure et le survol, et reçoit le
     clic droit à la place du bouton quand celui-ci est désactivé. */
  .split {
    position: relative;
    flex: none;
    display: flex;
    align-items: stretch;
    border: 1px solid transparent;
    border-radius: 6px;
  }
  .split:hover:not(.disabled) {
    background: var(--bg-raised);
    border-color: var(--border);
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
    border-radius: 6px;
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

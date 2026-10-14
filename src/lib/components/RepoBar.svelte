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
  import { elapsed } from "../autoFetch";
  import { externalApps } from "../externalApps.svelte";
  import { autoFetch } from "../autoFetch.svelte";
  import { i18n, t } from "../i18n.svelte";
  import { FLOW_KINDS, flowBase, flowTargets } from "../gitflow";
  import { repo, tabs, type Outcome, type RemoteOp } from "../stores/repo.svelte";
  import { isWide, visibleToolbar, type ToolbarItem } from "../toolbar";
  import { itemLabel, toolbar } from "../toolbar.svelte";
  import type { PullMode, PushMode } from "../types";
  import DiscardConfirm from "./DiscardConfirm.svelte";
  import ToolbarCustomizer from "./ToolbarCustomizer.svelte";
  import ToolbarIcon from "./ToolbarIcon.svelte";
  import ToolbarTile from "./ToolbarTile.svelte";

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
  const PULL_MENU_H = 210;

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
  const PUSH_MENU_H = 174;

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

  // ── Menu du bouton Git Flow ─────────────────────────────────────────────────
  //
  // Un seul bouton pour tout Git Flow, et son menu s'ouvre au clic gauche : le
  // bouton n'a pas d'action propre à lancer, contrairement à Pull et Push. En
  // tête, le « Finish » de la branche courante quand elle est d'une sorte Git
  // Flow ; dessous, toujours, les quatre « New ».
  let flowMenu = $state<{ x: number; y: number } | null>(null);
  const FLOW_MENU_W = 240;
  const FLOW_MENU_H = 190;

  function openFlowMenu(x: number, y: number) {
    flowMenu = {
      x: Math.max(8, Math.min(x, window.innerWidth - FLOW_MENU_W - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - FLOW_MENU_H - 8)),
    };
  }

  function runFlow(run: () => void) {
    flowMenu = null;
    run();
  }

  // ── Menu de la barre elle-même ──────────────────────────────────────────────
  //
  // Le clic droit sur la barre — son fond, le nom, le compte rendu, un bouton
  // sans menu à lui — ouvre « Customize toolbar… », comme celui de la barre
  // d'outils du Finder. Pull et Push gardent leur propre menu, qui finit par la
  // même entrée ; Git Flow, dont le menu s'ouvre déjà au clic gauche, laisse
  // son clic droit à la barre.
  let toolbarMenu = $state<{ x: number; y: number } | null>(null);
  const TOOLBAR_MENU_W = 200;
  const TOOLBAR_MENU_H = 44;

  function openToolbarMenu(x: number, y: number) {
    toolbarMenu = {
      x: Math.max(8, Math.min(x, window.innerWidth - TOOLBAR_MENU_W - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - TOOLBAR_MENU_H - 8)),
    };
  }

  /** Ferme tous les menus et passe la barre en personnalisation. */
  function customize() {
    toolbarMenu = null;
    pullMenu = null;
    pushMenu = null;
    confirmPush = null;
    flowMenu = null;
    toolbar.startEditing();
  }

  /** Ce que la barre affiche hors personnalisation. */
  const shown = $derived(visibleToolbar(toolbar.items, repo.flowEnabled));

  /** L'élément de la barre en cours de glissement, pâli à sa place. */
  const lifted = $derived(
    toolbar.drag?.source.kind === "bar" ? toolbar.drag.source.index : null,
  );

  /*
    Ce qui écrit déjà l'index ou le working directory rend indisponibles les
    boutons qui l'écrivent aussi : Pop, Stage all, Unstage all, Discard all.
  */
  const writing = $derived(
    !repo.repoInfo || repo.busy || repo.checkingOut || repo.mergingBranches || repo.stashing,
  );

  // ── Confirmation de « Discard all » ─────────────────────────────────────────
  // Le même panneau que dans la colonne de droite (`DiscardConfirm`), ancré
  // sous le bouton de la barre.
  let discardAt = $state<{ x: number; y: number } | null>(null);
  const DISCARD_W = 300;

  function openDiscard() {
    const r = barEl?.querySelector('[data-item="discard-all"]')?.getBoundingClientRect();
    if (!r) return;
    discardAt = {
      x: Math.max(8, Math.min(r.left, window.innerWidth - DISCARD_W - 8)),
      y: r.bottom + 4,
    };
  }

  /*
    Le dépôt n'est pas encore chargé le temps d'un aller-retour à l'ouverture
    d'un onglet. La barre reste en place — sa hauteur ne doit pas sauter — mais
    ses actions sont indisponibles, au même titre qu'avec une opération déjà en
    cours : elles n'auraient aucun `repoId` valide à envoyer.
  */
  const unavailable = $derived(repo.busyRemote || !repo.repoInfo);

  /*
    Compteurs qui montent : la pastille de Pull (`↓`) ou de Push (`↑`) rebondit
    quand son nombre augmente — un auto-fetch a ramené des commits à tirer, un
    commit en a ajouté à publier. Jamais quand il baisse : moins de travail en
    attente n'a rien à signaler. Ni d'un onglet à l'autre, ni pendant le
    chargement d'un dépôt, où les nombres partent de zéro sans que rien ne soit
    arrivé.

    L'animation passe par `Element.animate` plutôt que par une classe : la
    pastille peut naître avec le nombre (0 → 2), et une classe posée au montage
    rejouerait le rebond à chaque retour sur l'onglet.
  */
  let barEl = $state<HTMLElement | null>(null);
  const reducedMotion =
    typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  let lastGap: { repoId: string; loaded: boolean; ahead: number; behind: number } | null = null;

  $effect(() => {
    const gap = {
      repoId: repo.repoId,
      loaded: repo.loaded,
      ahead: repo.currentGap?.ahead ?? 0,
      behind: repo.currentGap?.behind ?? 0,
    };
    const prev = lastGap;
    lastGap = gap;
    if (!prev?.loaded || prev.repoId !== gap.repoId || reducedMotion?.matches) return;
    if (gap.behind > prev.behind) bump("pull");
    if (gap.ahead > prev.ahead) bump("push");
  });

  function bump(op: "pull" | "push") {
    barEl?.querySelector(`.action[data-op="${op}"] .badge`)?.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.45)", offset: 0.35 },
        { transform: "scale(0.92)", offset: 0.7 },
        { transform: "scale(1)" },
      ],
      { duration: 450, easing: "ease-out" },
    );
  }

  /*
    Auto-fetch : Fetch s'allume exactement comme pour un fetch cliqué — fond
    d'accent, icône qui tourne, barre de progression —, et se désactive, un
    second fetch n'ayant rien à faire. Pull et Push, eux, restent cliquables :
    leur clic attend la fin de l'auto-fetch au lieu d'échouer. Pas quand un
    geste de l'utilisateur tourne déjà : c'est son bouton qui est allumé.
  */
  const autoFetchShown = $derived(repo.autoFetchShown && !repo.runningOp);

  /**
   * Couleur du compte rendu : l'issue de la dernière opération. Pendant qu'une
   * opération tourne, le texte reste neutre — c'est le bouton et la barre de
   * progression qui travaillent.
   */
  const tone = $derived(
    repo.runningOp || autoFetchShown || repo.mergingBranches || repo.flowRunning
      ? null
      : repo.opTone,
  );

  /*
    Git Flow : créer ou terminer une branche de travail écrit le working
    directory — le bouton est indisponible tant qu'une autre écriture tourne,
    comme Branch et Stash.
  */
  const flowBusy = $derived(
    !repo.repoInfo ||
      repo.checkingOut ||
      repo.busy ||
      repo.mergingBranches ||
      repo.flowRunning ||
      // Une fusion en conflit attend sa résolution — y compris celle d'un
      // « Finish », qui reprendra au commit.
      repo.merging,
  );
  const lists = $derived(new Intl.ListFormat(i18n.locale, { type: "conjunction" }));

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
            : repo.deletingRemoteBranch
              ? t("toolbar.status.deletingRemoteBranch")
            : autoFetchShown
              ? t("toolbar.status.autoFetching")
              : repo.mergingBranches
              ? t("toolbar.status.merging")
              : repo.flowRunning && repo.flowFinish
                ? t("flow.finish.running", { branch: repo.flowFinish.branch })
                : repo.opStatus,
  );

  /*
    Horloge de l'infobulle de Fetch — « Last fetch: 3 minutes ago ». Elle n'a
    pas à être plus fine que la minute, l'unité la plus petite qu'elle affiche.
  */
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });
  const relative = $derived(new Intl.RelativeTimeFormat(i18n.locale, { numeric: "auto" }));

  /**
   * Seconde ligne de l'infobulle de Fetch : l'état de l'auto-fetch, puis à
   * quand remonte le dernier passage sur le réseau — auto ou manuel, c'est le
   * même `lastFetchAt` qui décide de la prochaine échéance.
   */
  const fetchHint = $derived.by(() => {
    const auto =
      repo.autoFetchPause === "credentials"
        ? t("toolbar.fetch.auto.paused")
        : repo.autoFetchPause === "noRemote"
          ? t("toolbar.fetch.auto.noRemote")
          : autoFetch.minutes === 0
            ? t("toolbar.fetch.auto.off")
            : t("toolbar.fetch.auto", { n: autoFetch.minutes });
    const lines = [t("toolbar.fetch.hint"), auto];
    if (repo.lastFetchAt > 0) {
      const { value, unit } = elapsed(now - repo.lastFetchAt);
      lines.push(t("toolbar.fetch.last", { when: relative.format(value, unit) }));
    }
    return lines.join("\n");
  });
</script>

<!-- Échap referme les menus, comme ceux de la colonne des branches. -->
<svelte:window
  onkeydown={(e) => {
    if (e.key !== "Escape") return;
    pullMenu = null;
    pushMenu = null;
    confirmPush = null;
    flowMenu = null;
    toolbarMenu = null;
    discardAt = null;
    // Échap pendant un glissement l'abandonne seulement (`toolbar.svelte.ts`) ;
    // sinon il referme la personnalisation, comme Done.
    if (toolbar.editing && !toolbar.drag) toolbar.stopEditing();
  }}
/>

<!-- Le clic droit et la touche Menu remontent jusqu'ici quand rien en dessous
     ne les a pris (`defaultPrevented`) : c'est le menu de la barre. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="repobar"
  class:editing={toolbar.editing}
  bind:this={barEl}
  oncontextmenu={(e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    if (!toolbar.editing) openToolbarMenu(e.clientX, e.clientY);
  }}
  onkeydown={(e) => {
    if (e.key !== "ContextMenu" || e.defaultPrevented || toolbar.editing) return;
    e.preventDefault();
    const r = (e.target as HTMLElement).getBoundingClientRect();
    openToolbarMenu(r.left, r.bottom + 2);
  }}
>
  <!-- Barre de progression indéterminée, juste sous le filet du bas : visible
       où qu'on regarde dans la fenêtre, tant qu'une opération distante — ou
       une fusion — tourne. Toujours dans le DOM, pour que son apparition et sa
       disparition se fassent en fondu plutôt qu'en saut. -->
  <div
    class="progress"
    class:on={repo.busyRemote || autoFetchShown || repo.mergingBranches || repo.flowRunning}
    aria-hidden="true"
  ></div>

  <!-- Le nom, puis la roue dentée des paramètres **de ce dépôt** : collée au
       nom parce qu'elle porte sur lui, là où celle de la barre d'onglets, au
       bord droit de la fenêtre, porte sur l'application. -->
  <div class="ident">
    <span class="name" title={repo.repoId}>{repo.displayName ?? "…"}</span>
    <button
      class="repo-settings"
      class:on={repo.settingsOpen}
      aria-pressed={repo.settingsOpen}
      title={t("repoSettings.open.hint")}
      aria-label={t("repoSettings.open")}
      disabled={!repo.repoInfo}
      onclick={() => (repo.settingsOpen ? repo.closeSettings() : repo.openSettings())}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="8" cy="8" r="2.1" />
        <path d="M12.9 9.8a1.1 1.1 0 0 0 .22 1.21l.04.04a1.33 1.33 0 1 1-1.88 1.88l-.04-.04a1.1 1.1 0 0 0-1.21-.22 1.1 1.1 0 0 0-.67 1v.11a1.33 1.33 0 1 1-2.67 0v-.06a1.1 1.1 0 0 0-.72-1 1.1 1.1 0 0 0-1.21.22l-.04.04a1.33 1.33 0 1 1-1.88-1.88l.04-.04a1.1 1.1 0 0 0 .22-1.21 1.1 1.1 0 0 0-1-.67h-.11a1.33 1.33 0 1 1 0-2.67h.06a1.1 1.1 0 0 0 1-.72 1.1 1.1 0 0 0-.22-1.21l-.04-.04a1.33 1.33 0 1 1 1.88-1.88l.04.04a1.1 1.1 0 0 0 1.21.22h.05a1.1 1.1 0 0 0 .67-1v-.11a1.33 1.33 0 1 1 2.67 0v.06a1.1 1.1 0 0 0 .67 1 1.1 1.1 0 0 0 1.21-.22l.04-.04a1.33 1.33 0 1 1 1.88 1.88l-.04.04a1.1 1.1 0 0 0-.22 1.21v.05a1.1 1.1 0 0 0 1 .67h.11a1.33 1.33 0 1 1 0 2.67h-.06a1.1 1.1 0 0 0-1 .67z" />
      </svg>
    </button>
  </div>

  <!--
    Les éléments de la barre, dans l'ordre choisi (`toolbar.ts`) — par défaut
    les trois actions distantes, un filet, les deux locales, un filet, Git Flow.
    Les filets disent la frontière entre ce qui parle au distant et ce qui
    reste local ; ils ne sont rendus qu'entre deux actions (`visibleToolbar`).
  -->
  <div class="actions" class:editing={toolbar.editing} class:drop-all={toolbar.drag?.source.kind === "default" && toolbar.drag.over}>
    {#if toolbar.editing}
      <!-- En personnalisation, la barre montre **tout** ce qu'elle contient —
           Git Flow compris sur un dépôt où il est désactivé, grisé — et ses
           éléments se glissent au lieu d'agir. Suppr les retire au clavier. -->
      {#each toolbar.items as item, i (i)}
        <div
          class="tb-slot"
          class:lifted={lifted === i}
          data-tb-index={i}
          role="button"
          tabindex="0"
          aria-label={itemLabel(item)}
          title={item === "gitflow" && !repo.flowEnabled
            ? `${t("toolbar.custom.flowOff")}\n${t("toolbar.custom.remove.hint")}`
            : t("toolbar.custom.remove.hint")}
          onpointerdown={(e) => toolbar.startDrag(e, { kind: "bar", index: i }, barEl)}
          onkeydown={(e) => {
            if (e.key !== "Delete" && e.key !== "Backspace") return;
            e.preventDefault();
            toolbar.remove(i);
          }}
        >
          <ToolbarTile {item} inBar muted={item === "gitflow" && !repo.flowEnabled} />
        </div>
      {:else}
        <p class="tb-empty">{t("toolbar.custom.empty")}</p>
      {/each}
    {:else}
      {#each shown as item, i (i)}
        {#if item === "separator"}
          <span class="group-sep" aria-hidden="true"></span>
        {:else if item === "space"}
          <span class="space" aria-hidden="true"></span>
        {:else}
          {@render toolbarAction(item)}
        {/if}
      {/each}
    {/if}
  </div>

  <!-- Marque d'insertion du glissement en cours, sur la barre. -->
  {#if toolbar.drag?.over && toolbar.drag.marker !== null}
    <span class="tb-marker" style="left: {toolbar.drag.marker}px" aria-hidden="true"></span>
  {/if}

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
    <div class="ctx-sep"></div>
    {@render customizeEntry()}
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
    <div class="ctx-sep"></div>
    {@render customizeEntry()}
  </div>
{/if}

<!-- Menu de la barre : une seule entrée, celle du Finder. -->
{#if toolbarMenu}
  <button
    class="ctx-overlay"
    aria-label={t("common.closeMenu")}
    onclick={() => (toolbarMenu = null)}
    oncontextmenu={(e) => {
      e.preventDefault();
      toolbarMenu = null;
    }}
  ></button>
  <div
    class="ctx-menu toolbar-menu"
    style="left: {toolbarMenu.x}px; top: {toolbarMenu.y}px"
    role="menu"
  >
    {@render customizeEntry()}
  </div>
{/if}

{#if discardAt}
  <DiscardConfirm
    style="position: fixed; left: {discardAt.x}px; top: {discardAt.y}px; width: {DISCARD_W}px"
    onclose={() => (discardAt = null)}
  />
{/if}

{#if toolbar.editing}
  <ToolbarCustomizer bar={barEl} />
{/if}

<!-- « Customize toolbar… » : seule entrée du menu de la barre, dernière de
     ceux de Pull et de Push. -->
{#snippet customizeEntry()}
  <button class="ctx-item" role="menuitem" onclick={customize}>
    <svg class="ctx-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="1.5" y="3" width="13" height="4.5" rx="1" />
      <path d="M4 10.5v3M8 10.5v3M12 10.5v3" />
    </svg>
    <span>{t("toolbar.customize")}</span>
  </button>
{/snippet}

<!--
  Menu du bouton Git Flow. Le « Finish » d'abord, seul et séparé : c'est le
  geste qui conclut le travail en cours, quand il y en a un. Il exige un
  working directory propre — c'est ce que demande git flow, et une fusion ne
  doit pas emporter du travail en cours vers `main`.
-->
{#if flowMenu}
  {@const kind = repo.flowEnabled ? repo.currentFlowKind : null}
  <button
    class="ctx-overlay"
    aria-label={t("common.closeMenu")}
    onclick={() => (flowMenu = null)}
    oncontextmenu={(e) => {
      e.preventDefault();
      flowMenu = null;
    }}
  ></button>
  <div
    class="ctx-menu flow-menu"
    style="left: {flowMenu.x}px; top: {flowMenu.y}px"
    role="menu"
  >
    {#if kind}
      <button
        class="ctx-item"
        role="menuitem"
        disabled={flowBusy || repo.changeCount > 0}
        title={repo.changeCount > 0
          ? t("flow.finish.dirty")
          : t("flow.finish.hint", {
              branch: repo.repoInfo?.branch ?? "",
              targets: lists.format(flowTargets(kind, repo.flowConfig)),
            })}
        onclick={() => runFlow(() => repo.askFinish())}
      >
        {@render flowFinishIcon()}
        <span>{t(`flow.finish.${kind}`)}</span>
      </button>
      <div class="ctx-sep"></div>
    {/if}
    {#each FLOW_KINDS as k (k)}
      <button
        class="ctx-item"
        role="menuitem"
        disabled={flowBusy}
        title={t(`flow.new.hint.${k}`, { base: flowBase(k, repo.flowConfig) })}
        onclick={() => runFlow(() => repo.askFlowBranch(k))}
      >
        {@render flowNewIcon()}
        <span>{t(`flow.new.${k}`)}</span>
      </button>
    {/each}
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

<!-- Un bouton d'action de la barre, par son identifiant : ce qui le distingue
     des autres — son action, son indisponibilité, son menu — est ici. -->
{#snippet toolbarAction(item: ToolbarItem)}
  {#if item === "pull"}
    {@render action({
      label: t("toolbar.pull"),
      op: "pull",
      icon: "pull",
      hint: currentPull.hint,
      run: currentPull.mode ? () => repo.pull(currentPull.mode!) : undefined,
      busy: unavailable,
      count: repo.currentGap?.behind,
      menu: { open: openPullMenu, hint: t("toolbar.pull.menu.hint") },
    })}
  {:else if item === "push"}
    {@render action({
      label: t("toolbar.push"),
      op: "push",
      icon: "push",
      hint: t("toolbar.push.hint"),
      run: () => repo.push(),
      busy: unavailable,
      count: repo.currentGap?.ahead,
      menu: { open: openPushMenu, hint: t("toolbar.push.menu.hint") },
    })}
  {:else if item === "fetch"}
    {@render action({
      label: t("toolbar.fetch"),
      op: "fetch",
      icon: "fetch",
      hint: fetchHint,
      run: () => repo.fetch(),
      busy: unavailable || autoFetchShown,
    })}
  {:else if item === "branch"}
    {@render action({
      label: t("toolbar.branch"),
      icon: "branch",
      hint: t("toolbar.branch.hint"),
      run: () => repo.askBranch(),
      // Il faut un commit où poser la branche (pas de HEAD non né), et rien
      // qui écrive déjà le working directory.
      busy: !repo.repoInfo?.head || repo.checkingOut || repo.busy || repo.mergingBranches,
    })}
  {:else if item === "stash"}
    {@render action({
      label: t("toolbar.stash"),
      icon: "stash",
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
  {:else if item === "pop"}
    {@const top = repo.stashes[0]}
    {@render action({
      label: t("toolbar.pop"),
      icon: "pop",
      hint: top ? t("toolbar.pop.hint", { name: top.message }) : t("toolbar.pop.nothing"),
      run: () => top && repo.applyStash(top.index, true),
      // Le pop écrit le working directory : indisponible pendant tout ce qui
      // l'écrit déjà. Un pop en conflit remonte dans le bandeau et laisse le
      // stash en place.
      busy: !top || writing,
    })}
  {:else if item === "tag"}
    {@render action({
      label: t("toolbar.tag"),
      icon: "tag",
      hint: t("toolbar.tag.hint"),
      run: () => repo.askTagAtHead(),
      // Un tag n'écrit qu'une référence, mais il lui faut un commit.
      busy: !repo.repoInfo?.head,
    })}
  {:else if item === "stage-all"}
    {@render action({
      label: t("toolbar.stageAll"),
      icon: "stage-all",
      hint: repo.unstagedEntries.length > 0 ? t("toolbar.stageAll.hint") : t("toolbar.stageAll.nothing"),
      run: () => repo.stageAll(),
      busy: repo.unstagedEntries.length === 0 || writing,
    })}
  {:else if item === "unstage-all"}
    {@render action({
      label: t("toolbar.unstageAll"),
      icon: "unstage-all",
      hint:
        repo.stagedEntries.length > 0 ? t("toolbar.unstageAll.hint") : t("toolbar.unstageAll.nothing"),
      run: () => repo.unstageAll(),
      busy: repo.stagedEntries.length === 0 || writing,
    })}
  {:else if item === "discard-all"}
    {@render action({
      label: t("toolbar.discardAll"),
      icon: "discard-all",
      hint: t("status.discardAll.hint"),
      // N'efface rien : ouvre la confirmation, sous le bouton.
      run: openDiscard,
      busy: repo.changeCount === 0 || writing,
      danger: true,
    })}
  {:else if item === "forge"}
    {@render action({
      label: t("toolbar.forge"),
      icon: "forge",
      hint: repo.prSupported ? t("toolbar.forge.hint") : t("toolbar.forge.none"),
      run: () => repo.openOnForge(),
      busy: !repo.repoInfo || !repo.prSupported,
    })}
  {:else if item === "finder"}
    {@render action({
      label: t("toolbar.finder"),
      icon: "finder",
      hint: t("toolbar.finder.hint"),
      run: () => repo.revealInFinder(),
      busy: !repo.repoInfo,
    })}
  {:else if item === "terminal"}
    {@const app = externalApps.apps.terminal}
    {@render action({
      label: t("toolbar.terminal"),
      icon: "terminal",
      hint: `${app ? t("toolbar.terminal.hint", { app }) : t("toolbar.terminal.none")}\n${t("toolbar.external.settings")}`,
      run: () => repo.openIn("terminal"),
      busy: !repo.repoInfo || !app,
    })}
  {:else if item === "editor"}
    {@const app = externalApps.apps.editor}
    {@render action({
      label: t("toolbar.editor"),
      icon: "editor",
      hint: `${app ? t("toolbar.editor.hint", { app }) : t("toolbar.editor.none")}\n${t("toolbar.external.settings")}`,
      run: () => repo.openIn("editor"),
      busy: !repo.repoInfo || !app,
    })}
  {:else if item === "gitflow"}
    {@render action({
      label: t("flow.menu"),
      icon: "gitflow",
      hint: t("flow.menu.hint"),
      busy: flowBusy,
      active: repo.flowRunning,
      menu: { open: openFlowMenu, hint: "" },
      dropdown: true,
    })}
  {/if}
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

  `dropdown` en fait un menu déroulant (Git Flow) : le clic gauche l'ouvre sous
  le bouton, qui n'a pas d'action à lui, et un ▾ l'annonce à côté du libellé.
-->
{#snippet action(a: {
  label: string;
  /**
   * L'opération distante que le bouton lance : c'est elle qu'il anime, et elle
   * seule. Absente pour un bouton local (Branch).
   */
  op?: RemoteOp;
  icon: ToolbarItem;
  hint: string;
  run?: () => void;
  busy?: boolean;
  count?: number;
  /** Menu du bouton : son infobulle, et son ouverture en coordonnées fenêtre. */
  menu?: { hint: string; open: (x: number, y: number) => void };
  /** Le clic gauche ouvre `menu` sous le bouton, au lieu d'une action. */
  dropdown?: boolean;
  /** Allumé comme un bouton en cours, hors des opérations distantes (Finish). */
  active?: boolean;
  /** Destructeur (Discard all) : dans le rouge tant qu'il est disponible. */
  danger?: boolean;
})}
  {@const live = a.run !== undefined || a.dropdown === true}
  {@const disabled = !live || a.busy}
  {@const running =
    a.active === true ||
    (a.op !== undefined && (repo.runningOp === a.op || (a.op === "fetch" && autoFetchShown)))}
  {@const flash = a.op !== undefined && repo.flash?.op === a.op ? repo.flash.outcome : null}
  {@const hint = live ? a.hint : `${a.hint} (${t("common.notAvailable")})`}
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
    title={a.menu?.hint ? `${hint}\n${a.menu.hint}` : hint}
    oncontextmenu={a.menu && !a.dropdown
      ? (e) => {
          e.preventDefault();
          a.menu!.open(e.clientX, e.clientY);
        }
      : undefined}
  >
    <button
      class="action"
      class:wide={isWide(a.icon)}
      class:danger={a.danger}
      data-item={a.icon}
      class:running
      data-op={a.op}
      {disabled}
      aria-busy={running}
      aria-haspopup={a.menu ? "menu" : undefined}
      onclick={a.dropdown
        ? (e) => {
            const r = e.currentTarget.getBoundingClientRect();
            a.menu?.open(r.left, r.bottom + 2);
          }
        : a.run}
      onkeydown={a.menu && !a.dropdown
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
          <span class="action-ic"><ToolbarIcon item={a.icon} /></span>
        {/if}
      {/key}
      {#if a.dropdown}
        <span class="drop">
          <span>{a.label}</span>
          <svg class="drop-ic" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M3.5 6 8 10.5 12.5 6Z" />
          </svg>
        </span>
      {:else}
        <span>{a.label}</span>
      {/if}
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

{#snippet flowNewIcon()}
  <!-- La branche du bouton Branch, avec un « + » : une branche de travail
       qui commence. -->
  <svg class="ctx-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="4.5" cy="3.5" r="1.75" />
    <circle cx="4.5" cy="12.5" r="1.75" />
    <path d="M4.5 5.25v5.5" />
    <path d="M4.5 9.5c0-2.2 2-3.5 4.5-3.5" />
    <path d="M12.5 3v5M10 5.5h5" />
  </svg>
{/snippet}

{#snippet flowFinishIcon()}
  <!-- Une branche qui rejoint la ligne principale, et une coche : elle
       revient d'où elle était partie, et elle est terminée. -->
  <svg class="ctx-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="4.5" cy="12.5" r="1.75" />
    <path d="M4.5 1.75v9" />
    <path d="M9.5 2.5c0 3-5 3.5-5 7" />
    <path d="M10 11l1.75 1.75L15 9.5" />
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
    /* Une barre d'outils, comme la barre d'onglets : rien à y copier. Posé sur
       la barre entière et non sur les seuls boutons, sinon une sélection
       commencée sur le nom du dépôt s'étendrait jusqu'aux libellés. */
    user-select: none;
    -webkit-user-select: none;
  }
  /* Nom et roue dentée : la roue suit le nom au lieu d'être repoussée au bout
     de la cellule, et c'est le nom qui s'abrège quand la place manque. */
  .ident {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .repo-settings {
    flex: none;
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-faint);
    cursor: pointer;
  }
  .repo-settings svg {
    display: block;
    width: 15px;
    height: 15px;
  }
  .repo-settings:hover:not(:disabled) {
    background: var(--bg-raised);
    color: var(--text);
  }
  /* Allumée tant que les paramètres du dépôt sont affichés : c'est aussi le
     bouton qui les referme. */
  .repo-settings.on {
    background: var(--accent-bg);
    color: var(--accent-soft);
  }
  .repo-settings:disabled {
    cursor: default;
    opacity: 0.5;
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
  /* Un espace : une place vide, de la largeur de son double en personnalisation. */
  .space {
    flex: none;
    width: 24px;
  }

  /*
    Personnalisation. La barre passe au-dessus du voile (60) et sous le panneau
    (62) : c'est elle qu'on remplit, elle doit rester nette. Sa zone d'actions
    se dessine — en pointillés, puis en accent quand la barre par défaut la
    survole, celle-ci remplaçant tout.
  */
  .repobar.editing {
    z-index: 61;
  }
  /* Le cadre de la zone est un pseudo-élément, pas une bordure ni un
     rembourrage : rien de ce qui se dessine en personnalisation ne doit
     changer la mise en page, sinon les boutons s'écartent en y entrant. Il
     déborde à l'horizontale, où la barre a de la place, et reste en retrait
     de 2px à la verticale — la zone fait déjà la hauteur de la barre. */
  .actions.editing {
    position: relative;
    /* Contexte d'empilement : le cadre passe derrière les boutons (`-1`)
       sans tomber sous le fond de la barre. */
    z-index: 0;
    min-height: 48px;
  }
  .actions.editing::before {
    content: "";
    position: absolute;
    z-index: -1;
    inset: 2px -6px;
    border: 1px dashed var(--text-faint);
    border-radius: 6px;
    pointer-events: none;
  }
  /* Vide, la zone garde une largeur où déposer. */
  .actions.editing:has(.tb-empty) {
    min-width: 160px;
    justify-content: center;
  }
  .actions.drop-all::before {
    border: 2px solid var(--accent);
    background: var(--accent-bg);
  }
  .tb-slot {
    flex: none;
    display: flex;
    border-radius: 5px;
    cursor: grab;
    touch-action: none;
  }
  .tb-slot:hover {
    background: var(--bg-raised);
  }
  /* L'élément tenu reste à sa place, pâli : l'étiquette qui suit le curseur
     le représente. */
  .tb-slot.lifted {
    opacity: 0.3;
  }
  .tb-empty {
    margin: 0;
    padding: 0 0.75rem;
    font-size: 0.74rem;
    color: var(--text-faint);
    white-space: nowrap;
  }
  .tb-marker {
    position: absolute;
    top: 6px;
    bottom: 6px;
    width: 2px;
    margin-left: -1px;
    border-radius: 1px;
    background: var(--accent);
    pointer-events: none;
  }
  .toolbar-menu {
    min-width: 200px;
  }
  /* Filet entre les actions distantes et les locales. Son encombrement est
     repris par `.sep-tile` (`ToolbarTile`) en personnalisation : à garder en
     accord, sinon les boutons s'écartent en y entrant. */
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
  /* Git Flow : son libellé et son ▾ ne tiennent pas dans un carré de 48px. La
     hauteur reste celle des autres. */
  .action.wide {
    width: auto;
    min-width: 48px;
    padding: 0 0.45rem;
    white-space: nowrap;
  }
  .action.danger:not(:disabled) {
    color: var(--danger);
  }
  .action:disabled {
    color: var(--text-faint);
    cursor: default;
    /* Laisse passer le clic droit jusqu'au cadre : voir la note du balisage. */
    pointer-events: none;
  }
  .action-ic {
    display: block;
    width: 20px;
    height: 20px;
  }
  /* Libellé d'un bouton à menu déroulant, suivi de son ▾. */
  .drop {
    display: flex;
    align-items: center;
    gap: 0.15rem;
  }
  .drop-ic {
    display: block;
    width: 0.6rem;
    height: 0.6rem;
    color: var(--text-faint);
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

  .flow-menu {
    min-width: 200px;
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

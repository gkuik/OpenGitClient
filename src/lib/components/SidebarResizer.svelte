<script lang="ts">
  /*
    Poignée de redimensionnement d'une colonne latérale.

    Elle est en `position: absolute` sur la frontière plutôt qu'en colonne de la
    grille : la grille, les bordures et les trois panneaux restent exactement ce
    qu'ils étaient, et rien ne se décale à l'ajout de la poignée. Sa position
    vient de la même variable CSS que la colonne, donc elle suit le glissement
    sans que personne ne la déplace.

    Le geste passe par les pointer events avec `setPointerCapture`, comme le
    glissement des onglets et pour la même raison : la capture garantit le
    `pointerup` même relâché hors de la fenêtre — sans elle, la poignée resterait
    collée au curseur.
  */
  import {
    layout,
    SIDEBAR_W_MAX,
    SIDEBAR_W_MIN,
    type Side,
  } from "../layout.svelte";

  let { side }: { side: Side } = $props();

  let el: HTMLDivElement;
  let dragging = $state(false);

  /*
    Géométrie du corps, mesurée une fois au `pointerdown`. La relire à chaque
    déplacement serait un reflow par image pour une valeur qui ne bouge pas : le
    corps occupe la fenêtre, qu'on ne redimensionne pas en même temps qu'une
    colonne.
  */
  let bodyLeft = 0;
  let bodyWidth = 0;

  function measure() {
    const rect = el.parentElement!.getBoundingClientRect();
    bodyLeft = rect.left;
    bodyWidth = rect.width;
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    measure();
    dragging = true;
    el.setPointerCapture(event.pointerId);
    // Coupe la sélection de texte et le glissement natif de WebKit ; le curseur
    // `col-resize` doit alors être forcé sur toute la page, la capture laissant
    // le pointeur survoler les panneaux.
    event.preventDefault();
    document.body.classList.add("resizing");
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging) return;
    const px =
      side === "left"
        ? event.clientX - bodyLeft
        : bodyLeft + bodyWidth - event.clientX;
    layout.setPx(side, px, bodyWidth);
  }

  function onPointerUp(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    el.releasePointerCapture(event.pointerId);
    document.body.classList.remove("resizing");
  }

  /** Flèches : même réglage au clavier, un demi-rem par appui, quatre avec Maj. */
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    measure();
    const towardsLeft = event.key === "ArrowLeft";
    // Pousser vers la gauche élargit la colonne de droite et rétrécit celle de
    // gauche : le signe dépend du côté.
    const sign = (towardsLeft ? -1 : 1) * (side === "left" ? 1 : -1);
    layout.nudge(side, sign * (event.shiftKey ? 2 : 0.5), bodyWidth);
  }

  const label = $derived(
    side === "left"
      ? "Redimensionner la colonne des branches"
      : "Redimensionner la colonne des changements",
  );
  const width = $derived(side === "left" ? layout.left : layout.right);
</script>

<!--
  Séparateur focusable : c'est le motif ARIA du « window splitter », qui est
  bien un widget malgré le rôle — d'où le `tabindex` et les valeurs. Les deux
  avertissements de Svelte visent le cas général d'un rôle non interactif rendu
  cliquable, pas celui-ci.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={el}
  class="resizer {side}"
  class:dragging
  role="separator"
  aria-orientation="vertical"
  aria-label={label}
  aria-valuenow={Math.round(width)}
  aria-valuemin={SIDEBAR_W_MIN}
  aria-valuemax={SIDEBAR_W_MAX}
  tabindex="0"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onkeydown={onKeyDown}
></div>

<style>
  .resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    /* En px, comme les autres zones de préhension : c'est une cible pour le
       curseur, pas du texte — elle n'a pas à grossir avec la police. */
    width: 9px;
    z-index: 5;
    cursor: col-resize;
    /* Sans ça, un glissement au trackpad défilerait le panneau au lieu de
       redimensionner. */
    touch-action: none;
  }
  /* La bande est centrée sur la bordure, qui appartient au panneau. */
  .resizer.left {
    left: var(--sidebar-l-w);
    margin-left: -4px;
  }
  .resizer.right {
    right: var(--sidebar-r-w);
    margin-right: -4px;
  }
  /* Le liseré ne s'allume qu'au survol : au repos, la frontière reste la
     bordure discrète des panneaux. */
  .resizer::after {
    content: "";
    position: absolute;
    inset: 0 4px;
    background: transparent;
    transition: background 0.12s ease;
  }
  .resizer:hover::after,
  .resizer.dragging::after,
  .resizer:focus-visible::after {
    background: var(--accent);
  }
  .resizer:focus {
    outline: none;
  }
</style>

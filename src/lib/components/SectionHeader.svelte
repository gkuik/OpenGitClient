<script lang="ts">
  import type { Snippet } from "svelte";
  import Chevron from "./Chevron.svelte";

  /*
    En-tête de section, commun aux deux colonnes latérales. C'est le **seul**
    endroit qui décide de la composition d'une section :

        bordure · [icône] TITRE (n) · [actions]   puis le contenu, chez l'appelant

    Les deux barres latérales avaient divergé sur chacun de ces points — icône à
    gauche seulement, compteur dans le libellé à droite, titre gras d'un côté et
    gris effacé de l'autre, trait de séparation porté par une classe différente
    dans chaque fichier. Centraliser le gabarit est ce qui empêche l'écart de
    revenir : une section nouvelle n'a plus de style à réinventer.

    La bordure de séparation est portée par cet en-tête, et non par la section,
    précisément parce qu'il en est le premier enfant : le trait tombe donc au bon
    endroit sans que l'appelant ait à en connaître l'existence. `first` l'ôte à la
    section en tête de colonne, dont le voisin du dessus (barre d'outils,
    en-tête de panneau) porte déjà le sien. Il n'y en a **qu'une**, au-dessus :
    un trait sous le titre l'enfermerait dans un bandeau et le détacherait du
    contenu qu'il annonce.

    Tout se centre sur l'axe de la barre, ce qui ne va pas de soi : `align-items`
    centre des *boîtes*, or l'encre d'un texte ou d'un SVG n'occupe pas forcément
    le milieu de la sienne. D'où le `display: block` sur l'icône plus bas, la
    taille du compteur héritée du titre, et le chevron confié à `Chevron` — qui
    dessine un tracé plutôt que le glyphe « ▶ », pour cette raison exactement.
  */
  let {
    label,
    icon,
    count,
    open,
    onToggle,
    actions,
    first = false,
  }: {
    label: string;
    /** SVG de la section ; dimensionné ici, quelle que soit sa boîte d'origine. */
    icon: Snippet;
    /** Omis quand il n'y a rien à compter : aucune pastille n'est alors dessinée. */
    count?: number;
    open: boolean;
    onToggle: () => void;
    /** Boutons de droite (« Tout indexer »…), collés au bord de la colonne. */
    actions?: Snippet;
    first?: boolean;
  } = $props();
</script>

<header class:first>
  <button class="sec-title" onclick={onToggle} aria-expanded={open}>
    <Chevron {open} />
    <span class="ic-slot">{@render icon()}</span>
    <span class="label">{label}</span>
    {#if count !== undefined}
      <span class="count">{count}</span>
    {/if}
  </button>
  {#if actions}
    <span class="actions">{@render actions()}</span>
  {/if}
</header>

<style>
  /*
    Hauteur **fixe**, la même pour toutes les sections des deux colonnes. Avec
    un rembourrage vertical, c'était le contenu qui la décidait : un en-tête qui
    porte des boutons (« Stage all », le filtre des PR) grandissait de plusieurs
    pixels et décalait tout ce qui suit. Les actions se centrent désormais dans
    la hauteur, sans pouvoir l'étirer. En rem, pour suivre la taille du texte ;
    le filet du haut est compris dedans (`border-box`), si bien que la première
    section, qui n'en a pas, a exactement la même hauteur que les autres.
  */
  header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: none;
    box-sizing: border-box;
    height: 2rem;
    padding: 0 var(--sec-gutter);
    border-top: 1px solid var(--border);
    background: var(--bg);
  }
  header.first {
    border-top: none;
  }
  /* `flex: 1` plutôt qu'une marge sur les actions : le compteur reste ainsi
     collé au titre, et c'est le bouton qui absorbe l'espace libre — donc le
     clic de repli couvre toute la largeur inoccupée de l'en-tête. */
  .sec-title {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    padding: 0;
    text-align: left;
    color: var(--text);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    cursor: pointer;
  }
  /* Les libellés sont écrits en casse normale et mis en capitales ici : une
     section de plus ne peut pas se tromper de casse. */
  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-transform: uppercase;
  }
  /*
    Un extrait rendu ici garde la portée de style du composant qui l'a *défini*,
    pas celle-ci : les règles de taille doivent donc viser le SVG globalement,
    depuis l'enveloppe. C'est ce qui garantit que toutes les icônes de section
    font la même taille, quel que soit le `viewBox` de chacune.
  */
  .ic-slot {
    flex: none;
    display: inline-flex;
  }
  .ic-slot :global(svg) {
    display: block;
    width: 14px;
    height: 14px;
    color: var(--text-dim);
  }
  /*
    Le compteur n'a **pas** de taille à lui : il hérite de celle du titre, et
    c'est ce qui l'aligne. Dans une barre en `align-items: center`, ce sont les
    *boîtes* qui se centrent, jamais les lignes de base ; deux tailles de police
    voisines donnent deux hauteurs de ligne différentes, donc deux lignes de base
    décalées — un quart de pixel avec les métriques de San Francisco, assez pour
    que le nombre flotte au-dessus du titre. À taille égale, les deux boîtes sont
    identiques et la question ne se pose plus, dans n'importe quel moteur.

    Un groupe `align-items: baseline` autour des deux règlerait aussi le cas,
    mais il repose sur la ligne de base qu'un item flex en `overflow: hidden`
    expose — précisément le genre de détail sur lequel WebKit et Chromium ont
    déjà divergé ici (voir la note sur les sections en grille). La couleur et la
    graisse suffisent à distinguer le compteur du libellé.
  */
  .count {
    flex: none;
    font-weight: 600;
    color: var(--accent-soft);
  }
  .actions {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
</style>

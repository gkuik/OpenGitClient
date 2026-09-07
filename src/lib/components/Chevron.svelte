<script lang="ts">
  /*
    Le chevron de repli, le même partout : en-têtes de section, dossiers de
    branches, nœuds de distant, dossiers de l'arborescence de fichiers. Ces
    quatre endroits l'écrivaient chacun de leur côté et avaient déjà divergé —
    0,55rem ici, 0,6rem là.

    **C'est un tracé, pas le glyphe « ▶ ».** Dans une barre en
    `align-items: center`, ce sont les *boîtes* qui se centrent, jamais l'encre :
    celle de ce caractère est haute d'un demi-pixel dans sa boîte de ligne, ce
    qui le sortait de l'axe de l'en-tête. Un tracé est centré sur son `viewBox`
    par construction, dans toutes les polices — et, accessoirement, il ne dépend
    plus de la présence du caractère dans la police du système.

    La taille est en rem : le chevron marque un pli dans du texte et suit donc la
    taille de ce texte, contrairement aux icônes de catégorie, figées en px.
  */
  let { open = false }: { open?: boolean } = $props();
</script>

<span class="chev" class:open aria-hidden="true">
  <svg viewBox="0 0 16 16" fill="currentColor">
    <path d="M6 3.5 11 8 6 12.5Z" />
  </svg>
</span>

<style>
  .chev {
    flex: none;
    display: inline-flex;
    color: var(--text-faint);
    transition: transform 0.1s ease;
  }
  /* `display: block` : en `inline`, le SVG s'assoirait sur une ligne de base et
     sa boîte gagnerait le jambage du dessous, décentrant le dessin de la moitié
     de ce jambage. */
  .chev svg {
    display: block;
    width: 0.75rem;
    height: 0.75rem;
  }
  .chev.open {
    transform: rotate(90deg);
  }
</style>

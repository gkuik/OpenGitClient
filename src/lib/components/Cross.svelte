<!--
  La croix des boutons de fermeture, la même partout : onglets, vue du diff,
  détails du commit, paramètres, bandeau d'erreur. Cinq boutons écrivaient le
  glyphe « × » chacun de leur côté, et aucun ne le centrait.

  **C'est un tracé, pas le glyphe « × »**, pour la raison qui a fait de `Chevron`
  un tracé : `align-items: center` centre des *boîtes*, jamais l'encre. Celle du
  signe de multiplication est assise sur l'axe mathématique de la police —
  au-dessus du milieu de sa boîte de ligne — et un `<button>` y ajoute son
  remplissage par défaut, si bien que la croix tombait toujours un peu haut et
  un peu à gauche de son cadre, dans toutes les polices et aux deux tailles.
  Un tracé est centré sur son `viewBox` par construction ; il ne reste au
  bouton qu'à centrer la boîte, ce que `inline-flex` fait sans reste.

  La taille est `1em` : la croix suit le `font-size` du bouton qui l'accueille,
  exactement comme le glyphe le faisait, si bien qu'aucun bouton n'a eu à
  changer de gabarit.
-->
<span class="cross" aria-hidden="true">
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
</span>

<style>
  .cross {
    flex: none;
    display: inline-flex;
  }
  /* `display: block` : en `inline`, le SVG s'assoirait sur une ligne de base et
     sa boîte gagnerait le jambage du dessous, décentrant le dessin. */
  .cross svg {
    display: block;
    width: 1em;
    height: 1em;
  }
</style>

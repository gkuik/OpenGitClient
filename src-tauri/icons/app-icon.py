"""Génère app-icon.svg : une double hélice dont les deux brins sont deux branches.

Usage : python3 app-icon.py app-icon.svg

Un seul croisement, au centre ; en haut comme en bas, les brins finissent en
deux verticales parallèles. Trois barreaux (des commits) de chaque côté,
espacés et décalés irrégulièrement, comme un vrai historique. Un seul dégradé
horizontal, indigo à gauche et turquoise à droite, colore tout le motif : les
brins changent de couleur en fondu en traversant, sans couture.

La forme est symétrique par rapport au centre (512, 512) : chaque brin est
décrit une fois, l'autre en est le miroir.
"""
import sys

CX = CY = 512
XL, XR = 366, 658   # verticales gauche et droite
Y_TIP = 196         # haut des brins (le bas est son symétrique)
Y_BEND = 318        # fin de la verticale, début de la courbe
K = 112             # tension de la courbe au départ de la verticale
CH, CV = 84, 50     # tension au centre : le croisement est à ~30° de l'horizontale
W = 34              # épaisseur d'un brin
RUNG_W = 22         # épaisseur d'un barreau
GAP = 12            # jour laissé de part et d'autre du brin de devant
NODE_R = 23         # tous les commits ont la même taille

# (hauteur du barreau, abscisse du commit)
RUNGS = [(244, 512), (320, 570), (416, 512), (597, 512), (688, 552), (770, 463)]


def strand(x0, x1):
    """Brin partant en haut à x0 et finissant en bas à x1, croisant le centre."""
    dx = 1 if x1 > x0 else -1
    yb = 2 * CY - Y_BEND
    return (
        f"M{x0} {Y_TIP} V{Y_BEND} "
        f"C{x0} {Y_BEND + K} {CX - dx * CH} {CY - CV} {CX} {CY} "
        f"C{CX + dx * CH} {CY + CV} {x1} {yb - K} {x1} {yb} "
        f"V{2 * CY - Y_TIP}"
    )


def strand_x(x0, x1, y):
    """Abscisse d'un brin à la hauteur y (la courbe est échantillonnée)."""
    dx = 1 if x1 > x0 else -1
    yb = 2 * CY - Y_BEND
    if y <= Y_BEND:
        return x0
    if y >= yb:
        return x1
    if y <= CY:
        p = [(x0, Y_BEND), (x0, Y_BEND + K), (CX - dx * CH, CY - CV), (CX, CY)]
    else:
        p = [(CX, CY), (CX + dx * CH, CY + CV), (x1, yb - K), (x1, yb)]
    best = None
    for i in range(2001):
        t = i / 2000
        u = 1 - t
        bx = u**3 * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t**3 * p[3][0]
        by = u**3 * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t**3 * p[3][1]
        if best is None or abs(by - y) < best[0]:
            best = (abs(by - y), bx)
    return best[1]


# Le brin de devant descend de droite à gauche ; celui de derrière, de gauche à droite.
BACK = strand(XL, XR)
FRONT = strand(XR, XL)

rungs, nodes = [], []
for y, nx in RUNGS:
    xa, xb = sorted((strand_x(XL, XR, y), strand_x(XR, XL, y)))
    rungs.append(f'<line x1="{xa:.1f}" y1="{y}" x2="{xb:.1f}" y2="{y}"/>')
    nodes.append(f'<circle cx="{nx}" cy="{y}" r="{NODE_R}"/>')

SVG = f"""<!--
  Source de l'icône, générée par app-icon.py : une double hélice d'ADN dont les
  deux brins sont deux branches et les barreaux des commits.
  app-icon.png en est le rendu 1024 px, dont
  `npm run tauri icon src-tauri/icons/app-icon.png` tire toutes les tailles.
  Grille macOS : tuile de 824 px à 100 px du bord, rayon 185, ombre dans la marge.
  Aucun flou sur le motif : réduit dans le Dock, un halo rend l'icône floue.
-->
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a2c33"/>
      <stop offset="0.5" stop-color="#1e1f24"/>
      <stop offset="1" stop-color="#18191d"/>
    </linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.2"/>
      <stop offset="0.1" stop-color="#ffffff" stop-opacity="0.05"/>
      <stop offset="0.9" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.3"/>
    </linearGradient>
    <!-- Un seul dégradé pour tout le motif : la couleur dit de quel côté on est. -->
    <linearGradient id="helix" gradientUnits="userSpaceOnUse" x1="{XL - W / 2}" y1="0" x2="{XR + W / 2}" y2="0">
      <stop offset="0" stop-color="#5d5fd8"/>
      <stop offset="0.5" stop-color="#4790d2"/>
      <stop offset="1" stop-color="#2ccdb0"/>
    </linearGradient>
    <!-- Reflet discret, plus clair en haut des brins. -->
    <linearGradient id="light" gradientUnits="userSpaceOnUse" x1="0" y1="{Y_TIP}" x2="0" y2="{2 * CY - Y_TIP}">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.1"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="commit" cx="0.38" cy="0.32" r="0.75">
      <stop offset="0" stop-color="#f4f9ff"/>
      <stop offset="1" stop-color="#c2dbf6"/>
    </radialGradient>
    <!-- Profondeur : le brin de derrière est effacé là où l'autre passe. -->
    <mask id="behind" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
      <rect width="1024" height="1024" fill="#fff"/>
      <path d="{FRONT}" fill="none" stroke="#000" stroke-width="{W + 2 * GAP}"/>
    </mask>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="14"/>
      <feOffset dy="12"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.38"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Tuile -->
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#tile)" filter="url(#shadow)"/>
  <rect x="101.5" y="101.5" width="821" height="821" rx="183.5" fill="none" stroke="url(#rim)" stroke-width="3"/>

  <!-- Barreaux, sous les brins -->
  <g stroke="url(#helix)" stroke-width="{RUNG_W}">{"".join(rungs)}</g>

  <!-- Brins -->
  <g fill="none" stroke-width="{W}" stroke-linecap="round">
    <g mask="url(#behind)">
      <path d="{BACK}" stroke="url(#helix)"/>
      <path d="{BACK}" stroke="url(#light)"/>
    </g>
    <path d="{FRONT}" stroke="url(#helix)"/>
    <path d="{FRONT}" stroke="url(#light)"/>
  </g>

  <!-- Commits -->
  <g fill="url(#commit)">{"".join(nodes)}</g>
</svg>
"""

if __name__ == "__main__":
    with open(sys.argv[1], "w") as f:
        f.write(SVG)

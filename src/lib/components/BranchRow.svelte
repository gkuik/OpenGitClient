<script lang="ts">
  import type { BranchTreeNode } from "../tree";
  import type { BranchEntry, RemoteBranchEntry, Upstream } from "../types";
  import { t } from "../i18n.svelte";
  import { repo } from "../stores/repo.svelte";
  import { branchMerge } from "../branchMerge.svelte";
  import BranchRow from "./BranchRow.svelte"; // récursion (auto-import Svelte 5)
  import Chevron from "./Chevron.svelte";

  // La même ligne sert aux sections LOCAL et REMOTE : seule l'entrée portée par
  // la feuille change, les dossiers étant identiques de part et d'autre.
  let {
    node,
    depth = 0,
  }: {
    node: BranchTreeNode<BranchEntry | RemoteBranchEntry>;
    depth?: number;
  } = $props();

  /**
   * Une entrée distante porte son distant, une locale son drapeau HEAD : la
   * forme de l'entrée suffit à les distinguer, sans drapeau à propager le long
   * de la récursion.
   */
  function asLocal(b: BranchEntry | RemoteBranchEntry): BranchEntry | null {
    return "remote" in b ? null : b;
  }

  /**
   * Double-clic / Entrée : bascule sur la branche. Sur une distante, le backend
   * crée la branche locale de suivi au passage (`origin/x` → `x`), ou bascule
   * sur celle qui porte déjà ce nom.
   */
  function checkout(b: BranchEntry | RemoteBranchEntry) {
    const local = asLocal(b);
    if (local) repo.checkoutBranch(local.name);
    else repo.checkoutRemoteBranch(b.name);
  }

  /**
   * Clic simple : sélectionne la tête de la branche dans le graph. Le `click`
   * qui suit un glissement est ignoré : il vise la ligne de départ, alors que le
   * geste portait sur celle où on a lâché.
   */
  function selectTip(oid: string) {
    if (branchMerge.consumeClick()) return;
    if (oid) repo.selectCommit(oid);
  }

  /**
   * Clic droit sur une branche locale : le menu de la branche — en partir pour
   * une nouvelle, la tirer, et y fusionner la branche **courante**, le même
   * sens que le dépôt : la ligne visée reçoit la fusion.
   *
   * La source se lit dans la liste des branches et non dans `repoInfo.branch`,
   * qui nomme aussi une branche **non encore née** — sans référence, donc rien
   * à fusionner. Sans branche courante (HEAD détaché, ou non né), la source
   * vaut la cible : le menu s'ouvre quand même, sans ses entrées de fusion.
   *
   * Le menu natif est refusé dans tous les cas : une ligne de branche
   * n'appartient pas au webview.
   */
  function askMerge(e: MouseEvent, target: string) {
    e.preventDefault();
    const source = repo.branches.find((b) => b.isHead)?.name ?? target;
    branchMerge.ask(source, target, e.clientX, e.clientY);
  }

  /** Clic droit sur une branche distante : seule la création en part. */
  function askRemote(e: MouseEvent, name: string) {
    e.preventDefault();
    branchMerge.ask(name, name, e.clientX, e.clientY, false, true);
  }

  /**
   * Infobulle des compteurs. Elle nomme l'amont et rappelle d'où vient le
   * chiffre : deux références locales, donc l'état du dernier fetch — pas ce
   * que le serveur contient à l'instant présent.
   */
  function gapHint(up: Upstream): string {
    const parts: string[] = [];
    if (up.ahead > 0) parts.push(t("branches.gap.ahead", { n: up.ahead }));
    if (up.behind > 0) parts.push(t("branches.gap.behind", { n: up.behind }));
    return t("branches.gap.hint", { gap: parts.join(" · "), upstream: up.name });
  }
</script>

{#if node.type === "branch"}
  {@const local = asLocal(node.branch)}
  {@const current = local?.isHead ?? false}
  {@const selected = repo.selectedCommitOid === node.branch.oid && node.branch.oid !== ""}
  <!--
    Clic simple : sélectionne le dernier commit de la branche dans le graph.
    Double-clic pour basculer (convention GitKraken). `Enter` fait la même chose
    pour garder l'équivalent clavier, le dblclick n'étant pas atteignable autrement.
  -->
  {@const dragged = local !== null && branchMerge.dragging === local.name}
  {@const dropOn = local !== null && branchMerge.over === local.name}
  <!--
    `data-branch` n'est pas décoratif : c'est par lui que le glissement retrouve
    la ligne sous le curseur (voir `branchMerge.svelte.ts`). Seules les branches
    locales le portent, donc une branche distante n'est ni source ni cible.
  -->
  <div
    class="branch"
    class:current
    class:selected
    class:dragged
    class:drop-on={dropOn}
    role="button"
    tabindex="0"
    data-branch={local?.name}
    style="padding-left: calc(var(--row-inset) + {depth * 12}px)"
    title={local
      ? t("branches.hint.local", { name: local.name })
      : t("branches.hint.remote", { name: node.branch.name })}
    onclick={() => selectTip(node.branch.oid)}
    ondblclick={() => checkout(node.branch)}
    onkeydown={(e) => (e.key === "Enter" ? checkout(node.branch) : undefined)}
    onpointerdown={local ? (e) => branchMerge.startDrag(local.name, e) : undefined}
    oncontextmenu={(e) => (local ? askMerge(e, local.name) : askRemote(e, node.branch.name))}
  >
    <span class="mark">{current ? "✓" : ""}</span>
    <svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="4.5" cy="3.5" r="1.75" />
      <circle cx="4.5" cy="12.5" r="1.75" />
      <circle cx="11.5" cy="5" r="1.75" />
      <path d="M4.5 5.25v5.5" stroke-linecap="round" />
      <path d="M9.75 6.4A5 5 0 0 1 6.2 11.9" stroke-linecap="round" />
    </svg>
    <span class="bname">{node.name}</span>
    <!--
      Écart avec l'amont. Un compteur nul n'est pas affiché, et une branche sans
      amont n'en a aucun : la pastille signale un écart, elle ne certifie pas
      une synchronisation.
    -->
    {#if local?.upstream}
      {@const up = local.upstream}
      {@const hint = gapHint(up)}
      {#if up.ahead > 0}
        <span class="gap ahead" title={hint}>↑{up.ahead}</span>
      {/if}
      {#if up.behind > 0}
        <span class="gap behind" title={hint}>↓{up.behind}</span>
      {/if}
    {/if}
  </div>
{:else}
  {@const open = repo.isBranchDirOpen(node.path)}
  <button
    class="dir"
    style="padding-left: calc(var(--row-inset) + {depth * 12}px)"
    onclick={() => repo.toggleBranchDir(node.path)}
    aria-expanded={open}
  >
    <Chevron {open} />
    <svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
      <path d="M1.75 4.25a1 1 0 0 1 1-1h3.1l1.5 1.6h6.9a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z" />
    </svg>
    <span class="dname">{node.name}</span>
  </button>
  {#if open}
    {#each node.children as child (child.type === "dir" ? "d:" + child.path : "b:" + child.branch.name)}
      <BranchRow node={child} depth={depth + 1} />
    {/each}
  {/if}
{/if}

<style>
  .branch,
  .dir {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    background: transparent;
    border: none;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.82rem;
    text-align: left;
    color: var(--text);
  }
  .branch:hover,
  .dir:hover {
    background: var(--bg-raised);
  }
  /* Branche courante : fond vert + coche, comme la référence. */
  .branch.current {
    background: var(--ok-bg);
    color: var(--ok-soft);
    font-weight: 600;
  }
  .branch.current:hover {
    background: var(--ok-bg-hover);
  }
  /* Branche dont la tête est le commit affiché à droite : fond accent sur
     toute la ligne, comme un fichier sélectionné — et une autre couleur que le
     vert de la branche courante, qui garde sa coche et sa graisse quand les
     deux états se cumulent. (Un liseré `inset` à gauche a été essayé : courbé
     par le rayon de la ligne, il se lisait comme un crochet.) */
  .branch.selected,
  .branch.selected:hover {
    background: var(--accent-bg);
    color: var(--accent-soft);
  }
  .branch.selected .ic {
    color: var(--accent);
  }
  /* Branche tenue par le curseur : c'est l'étiquette qui suit le pointeur qui
     la représente, la ligne s'efface pour le dire. */
  .branch.dragged {
    opacity: 0.45;
  }
  /* Ligne sous le curseur : là où la fusion serait reçue. Le liseré est en
     `outline` et non en `border`, qui décalerait la ligne d'un pixel — et le
     cadre doit se superposer au fond vert de la branche courante, qui est une
     cible comme une autre. */
  .branch.drop-on {
    background: var(--accent-bg);
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  .mark {
    flex: none;
    width: 0.8rem;
    font-size: 0.7rem;
    color: var(--ok);
  }
  .ic {
    flex: none;
    width: 13px;
    height: 13px;
    color: var(--text-faint);
  }
  .branch.current .ic {
    color: var(--ok);
  }
  /* Écart avec l'amont : à pousser en accent, à récupérer en atténué. Les
     chiffres sont tabulaires pour que les pastilles ne dansent pas d'une ligne
     à l'autre. */
  .gap {
    flex: none;
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
  }
  .gap.ahead {
    color: var(--accent-soft);
  }
  .gap.behind {
    color: var(--text-faint);
  }
  .bname,
  .dname {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dir {
    color: var(--text-dim);
  }
</style>

// Rendu Markdown minimal des descriptions de commit.
//
// Volontairement sans bibliothèque. Deux raisons :
//
//  1. Sécurité. Passer par une bibliothèque signifie produire du HTML, donc
//     `{@html}` côté Svelte — sur un contenu écrit par des tiers (n'importe qui
//     peut rédiger le message de commit d'un dépôt qu'on clone), dans un webview
//     qui a accès à `invoke`. Ici on produit un arbre de blocs que Svelte rend
//     avec son échappement habituel : il n'y a aucune surface d'injection.
//  2. Empreinte. Le projet n'a aujourd'hui aucune dépendance runtime hors API
//     Tauri, et un message de commit n'utilise qu'une poignée de constructions.
//
// Sous-ensemble couvert : titres, listes à puces et numérotées (à plat),
// citations, blocs de code clôturés, code inline, gras, italique, liens
// `[texte](url)` et URL nues.
//
// Écarts assumés par rapport à CommonMark :
//  - les retours à la ligne simples sont **conservés** (comme GitHub sur les
//    messages de commit) : un message est coupé à 72 colonnes, les recoller en
//    paragraphe fluide collerait aussi les trailers `Co-Authored-By:` entre eux ;
//  - `_texte_` n'est **pas** de l'italique : `commit_graph`, `stage_all` et tout
//    le snake_case d'un message de commit se retrouveraient massacrés ;
//  - `*texte*` exige un contenu qui ne commence ni ne finit par une espace, ce
//    qui évite qu'une ligne comme « refs/heads/* et refs/tags/* » soit lue comme
//    de l'italique ;
//  - les listes imbriquées sont rendues à plat.

export type Inline =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string }
  | { kind: "strong"; value: string }
  | { kind: "em"; value: string }
  | { kind: "link"; value: string; href: string };

export type Block =
  | { kind: "paragraph"; lines: Inline[][] }
  | { kind: "heading"; level: number; content: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "code"; lang: string | null; text: string }
  | { kind: "quote"; lines: Inline[][] };

const FENCE = /^\s*```(\w*)\s*$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s{0,4}[-*+]\s+(.+)$/;
const ORDERED = /^\s{0,4}\d+[.)]\s+(.+)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;

/** Une ligne ouvre-t-elle un bloc autre qu'un paragraphe ? */
function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line) ||
    QUOTE.test(line)
  );
}

export function parseMarkdown(input: string): Block[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    // ── Bloc de code clôturé ──
    const fence = FENCE.exec(line);
    if (fence) {
      const lang = fence[1] || null;
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      i++; // consomme la clôture (absente si le bloc n'est jamais refermé)
      blocks.push({ kind: "code", lang, text: body.join("\n") });
      continue;
    }

    // ── Titre ──
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        content: parseInline(heading[2]),
      });
      i++;
      continue;
    }

    // ── Liste ──
    const ordered = !BULLET.test(line) && ORDERED.test(line);
    if (ordered || BULLET.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = (ordered ? ORDERED : BULLET).exec(lines[i]);
        if (!m) break;
        items.push(parseInline(m[1]));
        i++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    // ── Citation ──
    if (QUOTE.test(line)) {
      const quoted: Inline[][] = [];
      while (i < lines.length) {
        const m = QUOTE.exec(lines[i]);
        if (!m) break;
        quoted.push(parseInline(m[1]));
        i++;
      }
      blocks.push({ kind: "quote", lines: quoted });
      continue;
    }

    // ── Paragraphe : lignes consécutives, retours à la ligne conservés ──
    const paragraph: Inline[][] = [];
    while (i < lines.length && lines[i].trim() !== "" && !startsBlock(lines[i])) {
      paragraph.push(parseInline(lines[i]));
      i++;
    }
    if (paragraph.length === 0) {
      // Ne devrait pas arriver (les ouvertures de bloc sont traitées au-dessus),
      // mais on avance quoi qu'il arrive : une boucle infinie figerait l'UI.
      i++;
      continue;
    }
    blocks.push({ kind: "paragraph", lines: paragraph });
  }

  return blocks;
}

export function parseInline(text: string): Inline[] {
  // Regex construite à chaque appel : une regex globale partagée garderait son
  // `lastIndex` d'un appel à l'autre.
  const re =
    /(`+)([^`]+?)\1|\*\*([^\s*](?:[^*\n]*[^\s*])?)\*\*|\*([^\s*](?:[^*\n]*[^\s*])?)\*|\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>)\]]+)/g;

  const out: Inline[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ kind: "text", value: text.slice(last, m.index) });
    }
    if (m[2] !== undefined) out.push({ kind: "code", value: m[2] });
    else if (m[3] !== undefined) out.push({ kind: "strong", value: m[3] });
    else if (m[4] !== undefined) out.push({ kind: "em", value: m[4] });
    else if (m[5] !== undefined) out.push({ kind: "link", value: m[5], href: m[6] });
    else if (m[7] !== undefined) out.push({ kind: "link", value: m[7], href: m[7] });
    last = m.index + m[0].length;
  }

  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}

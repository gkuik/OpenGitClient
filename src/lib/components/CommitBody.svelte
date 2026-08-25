<script lang="ts">
  import { parseMarkdown, type Inline } from "../markdown";

  let { text }: { text: string } = $props();

  const blocks = $derived(parseMarkdown(text));
</script>

<!--
  Tout le contenu passe par l'interpolation Svelte, jamais par `{@html}` : un
  message de commit vient de l'extérieur et ne doit pas pouvoir injecter de
  balise dans le webview.

  Le snippet est écrit **sur une seule ligne** à dessein : indenter entre les
  branches fait dépendre le résultat des règles de rognage d'espaces de Svelte,
  et le moindre nœud texte résiduel se verrait entre un élément inline et la
  ponctuation qui le suit (« `code` . » au lieu de « `code`. »). Ici il n'y a
  simplement aucune espace à rogner.

  Les liens sont rendus en <span> et non en <a> : l'app n'a pas la capacité
  `shell:allow-open`, un lien cliquable ferait donc naviguer le webview hors de
  l'application. L'URL complète reste lisible en infobulle.
-->
{#snippet inline(parts: Inline[])}{#each parts as part, i (i)}{#if part.kind === "code"}<code>{part.value}</code>{:else if part.kind === "strong"}<strong>{part.value}</strong>{:else if part.kind === "em"}<em>{part.value}</em>{:else if part.kind === "link"}<span class="link" title={part.href}>{part.value}</span>{:else}{part.value}{/if}{/each}{/snippet}

<div class="md">
  {#each blocks as block, bi (bi)}
    {#if block.kind === "heading"}
      <p class="h h{block.level}">{@render inline(block.content)}</p>
    {:else if block.kind === "code"}
      <pre class="code" title={block.lang ?? undefined}>{block.text}</pre>
    {:else if block.kind === "list"}
      {#if block.ordered}
        <ol>
          {#each block.items as item, ii (ii)}
            <li>{@render inline(item)}</li>
          {/each}
        </ol>
      {:else}
        <ul>
          {#each block.items as item, ii (ii)}
            <li>{@render inline(item)}</li>
          {/each}
        </ul>
      {/if}
    {:else if block.kind === "quote"}
      <blockquote>
        {#each block.lines as line, li (li)}
          <span class="line">{@render inline(line)}</span>
        {/each}
      </blockquote>
    {:else}
      <p>
        {#each block.lines as line, li (li)}
          <span class="line">{@render inline(line)}</span>
        {/each}
      </p>
    {/if}
  {/each}
</div>

<style>
  .md {
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--text-dim);
    word-break: break-word;
  }
  .md :global(p),
  .md :global(ul),
  .md :global(ol),
  .md :global(blockquote),
  .md :global(pre) {
    margin: 0 0 0.45rem;
  }
  .md > :last-child {
    margin-bottom: 0;
  }
  /* Les retours à la ligne du message sont conservés : chaque ligne est un bloc. */
  .line {
    display: block;
  }
  .h {
    color: var(--text);
    font-weight: 700;
  }
  .h1,
  .h2 {
    font-size: 0.9rem;
  }
  ul,
  ol {
    padding-left: 1.15rem;
  }
  li {
    margin: 0.1rem 0;
  }
  ul {
    list-style: disc;
  }
  blockquote {
    padding-left: 0.6rem;
    border-left: 2px solid var(--border);
    color: var(--text-faint);
  }
  code {
    font-family: var(--mono);
    font-size: 0.92em;
    background: var(--bg-raised);
    padding: 0.05rem 0.25rem;
    border-radius: 3px;
  }
  .code {
    font-family: var(--mono);
    font-size: 0.75rem;
    line-height: 1.45;
    background: var(--bg-raised);
    padding: 0.4rem 0.5rem;
    border-radius: 4px;
    overflow-x: auto;
    white-space: pre;
  }
  strong {
    color: var(--text);
    font-weight: 700;
  }
  .link {
    color: var(--accent-soft);
    text-decoration: underline;
    text-decoration-style: dotted;
  }
</style>

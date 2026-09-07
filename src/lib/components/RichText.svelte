<script lang="ts">
  /*
    Une phrase du catalogue dont certains mots sont mis en forme.

    Le texte reste **une seule entrée** de catalogue : découper une phrase en
    « avant », « le mot en gras » et « après » suppose que l'ordre des mots
    survive à la traduction, ce qu'aucune langue ne garantit. `tParts` rend la
    phrase puis dit quels morceaux viennent d'un paramètre, et c'est ici qu'on
    décide de la balise à leur donner.

    Un paramètre `{ text, tag }` est mis en forme, une chaîne nue est insérée
    telle quelle.
  */
  import { tParts, type MessageKey, type Params } from "../i18n.svelte";

  type Rich = { text: string; tag: "strong" | "code" };

  let {
    key,
    params = {},
  }: { key: MessageKey; params?: Record<string, string | number | Rich> } = $props();

  const values = $derived(
    Object.fromEntries(
      Object.entries(params).map(([name, value]) => [
        name,
        typeof value === "object" ? value.text : value,
      ]),
    ) as Params,
  );

  const tags = $derived(
    new Map(
      Object.entries(params)
        .filter(([, value]) => typeof value === "object")
        .map(([name, value]) => [name, (value as Rich).tag]),
    ),
  );

  const parts = $derived(tParts(key, values));
</script>

<!-- Écrit sur une seule ligne : la moindre indentation entre les branches
     laisserait un nœud texte visible entre un mot mis en forme et la
     ponctuation qui le suit (voir la même note dans `CommitBody`). -->
{#each parts as part, i (i)}{#if part.param && tags.get(part.param) === "code"}<code>{part.text}</code>{:else if part.param && tags.has(part.param)}<strong>{part.text}</strong>{:else}{part.text}{/if}{/each}

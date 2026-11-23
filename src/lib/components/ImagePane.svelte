<script lang="ts">
  import { i18n, t } from "../i18n.svelte";
  import { formatBytes, formatBytesDelta, imageDataUrl } from "../images";
  import type { ImageBlob } from "../types";

  // Un côté de la comparaison : l'image sur un damier (la transparence doit se
  // voir), puis ses dimensions et son poids. Les dimensions ne sont connues
  // qu'une fois l'image décodée — le backend n'envoie que des octets.
  let {
    label,
    side,
    path,
    blob,
    compareTo = null,
  }: {
    label: string;
    side: "before" | "after";
    path: string;
    blob: ImageBlob;
    /** Poids de l'autre côté, pour dire l'écart ; seulement sur l'après. */
    compareTo?: number | null;
  } = $props();

  let size = $state<{ width: number; height: number } | null>(null);
  let broken = $state(false);

  const src = $derived(blob.data ? imageDataUrl(path, blob.data) : null);
  const weight = $derived(formatBytes(blob.size, i18n.locale));
  const delta = $derived(
    compareTo === null ? null : formatBytesDelta(compareTo, blob.size, i18n.locale),
  );

  function loaded(event: Event) {
    const img = event.currentTarget as HTMLImageElement;
    // Un SVG sans `width` / `height` n'a pas de taille propre : rien à dire.
    size = img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null;
  }
</script>

<figure class="pane {side}">
  <figcaption>{label}</figcaption>
  <div class="frame">
    {#if !src}
      <p class="note">{t("diff.image.tooLarge", { size: weight })}</p>
    {:else if broken}
      <p class="note">{t("diff.image.broken")}</p>
    {:else}
      <img {src} alt={label} onload={loaded} onerror={() => (broken = true)} draggable="false" />
    {/if}
  </div>
  <div class="meta">
    {#if size}
      <span>{t("diff.image.dimensions", { width: size.width, height: size.height })}</span>
    {/if}
    <span>{weight}</span>
    {#if delta}
      <span class="delta" title={t("diff.image.delta", { delta })}>{delta}</span>
    {/if}
  </div>
</figure>

<style>
  .pane {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  figcaption {
    font-size: 0.75rem;
    font-weight: 600;
  }
  .before figcaption {
    color: var(--danger-soft);
  }
  .after figcaption {
    color: var(--ok-soft);
  }
  /* Le damier dit la transparence ; la bordure, de quel côté on est — le
     rouge et le vert du diff texte. */
  .frame {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.8rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: repeating-conic-gradient(var(--bg-raised) 0 25%, var(--bg) 0 50%) 0 0 / 16px 16px;
    overflow: hidden;
  }
  .before .frame {
    border-color: var(--danger-border);
  }
  .after .frame {
    border-color: var(--ok-border);
  }
  /* Jamais agrandie — une icône de 16 px reste une icône de 16 px —, réduite
     seulement pour tenir dans son cadre. */
  img {
    display: block;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .note {
    margin: 0;
    color: var(--text-dim);
    font-size: 0.82rem;
    text-align: center;
  }
  .meta {
    display: flex;
    gap: 0.5rem;
    font-size: 0.75rem;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .meta span + span::before {
    content: "·";
    margin-right: 0.5rem;
    color: var(--text-faint);
  }
  .delta {
    color: var(--text);
  }
</style>

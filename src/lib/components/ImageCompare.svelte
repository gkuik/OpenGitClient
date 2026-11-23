<script lang="ts">
  import { t } from "../i18n.svelte";
  import { repo } from "../stores/repo.svelte";
  import ImagePane from "./ImagePane.svelte";

  // Avant / après côte à côte, comme le diff d'image d'une forge. Un ajout
  // n'a que son après, une suppression que son avant : le libellé le dit
  // alors, plutôt qu'un cadre vide en face.
  const images = $derived(repo.images);
  const path = $derived(repo.selectedPath ?? "");
  const both = $derived(images?.before != null && images?.after != null);
</script>

{#if !images}
  <p class="placeholder">{t("diff.image.loading")}</p>
{:else if !images.before && !images.after}
  <p class="placeholder">{t("diff.image.none")}</p>
{:else}
  <!-- Clé sur l'objet reçu : un rechargement remet à zéro les dimensions
       mesurées et l'état « illisible » de chaque côté. -->
  {#key images}
    <div class="compare">
      {#if images.before}
        <ImagePane
          side="before"
          label={both ? t("diff.image.before") : t("diff.image.deleted")}
          {path}
          blob={images.before}
        />
      {/if}
      {#if images.after}
        <ImagePane
          side="after"
          label={both ? t("diff.image.after") : t("diff.image.added")}
          {path}
          blob={images.after}
          compareTo={images.before?.size ?? null}
        />
      {/if}
    </div>
  {/key}
{/if}

<style>
  .placeholder {
    margin: auto;
    color: var(--text-dim);
    font-size: 0.9rem;
  }
  .compare {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    gap: 1rem;
    padding: 1rem;
  }
</style>

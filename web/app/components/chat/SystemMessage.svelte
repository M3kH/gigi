<script lang="ts">
  /**
   * System message banner — muted centered display for system events (webhooks, etc.)
   */
  interface Props {
    text: string
  }

  const { text }: Props = $props()
</script>

<div class="system-message">
  <span class="system-icon">i</span>
  <span class="system-text">{text}</span>
</div>

<style>
  .system-message {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--gigi-space-sm);
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    margin: var(--gigi-space-sm) 0;
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
  }

  .system-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 1px solid var(--gigi-border-muted);
    font-size: 0.6rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  .system-text {
    font-style: italic;
  }
</style>

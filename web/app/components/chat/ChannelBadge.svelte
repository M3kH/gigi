<script lang="ts">
  /**
   * Channel badge — shows the origin channel of a thread event.
   * Renders as a small colored tag on the message bubble.
   */
  interface Props {
    channel: string
    direction?: string
  }

  const { channel, direction }: Props = $props()

  const channelConfig: Record<string, { label: string; icon: string; className: string }> = {
    web: { label: 'Web', icon: '💬', className: 'ch-web' },
    telegram: { label: 'Telegram', icon: '📱', className: 'ch-telegram' },
    gitea_comment: { label: 'Gitea', icon: '💬', className: 'ch-gitea' },
    gitea_review: { label: 'Review', icon: '👀', className: 'ch-review' },
    webhook: { label: 'Event', icon: '⚡', className: 'ch-webhook' },
    system: { label: 'System', icon: '⚙️', className: 'ch-system' },
  }

  const config = $derived(channelConfig[channel] || { label: channel, icon: '💬', className: 'ch-web' })
  const dirLabel = $derived(direction === 'outbound' ? '→' : '')
</script>

<span class="channel-badge {config.className}" title="{config.label}{dirLabel ? ' (outbound)' : ''}">
  <span class="ch-icon">{config.icon}</span>
  <span class="ch-label">{config.label}</span>
  {#if dirLabel}
    <span class="ch-dir">{dirLabel}</span>
  {/if}
</span>

<style>
  .channel-badge {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 0.6rem;
    padding: 1px 5px;
    border-radius: var(--gigi-radius-full, 9999px);
    line-height: 1.3;
    font-weight: 500;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .ch-icon {
    font-size: 0.55rem;
  }

  .ch-label {
    letter-spacing: 0.01em;
  }

  .ch-dir {
    font-size: 0.55rem;
    opacity: 0.7;
  }

  /* Channel color variants */
  .ch-web {
    background: rgba(139, 148, 158, 0.15);
    color: var(--gigi-text-muted);
  }

  .ch-telegram {
    background: rgba(88, 166, 255, 0.15);
    color: var(--gigi-accent-blue, #58a6ff);
  }

  .ch-gitea {
    background: rgba(63, 185, 80, 0.15);
    color: var(--gigi-accent-green, #3fb950);
  }

  .ch-review {
    background: rgba(210, 153, 34, 0.15);
    color: var(--gigi-accent-orange, #d29922);
  }

  .ch-webhook {
    background: rgba(139, 148, 158, 0.1);
    color: var(--gigi-text-muted);
  }

  .ch-system {
    background: rgba(139, 148, 158, 0.08);
    color: var(--gigi-text-muted);
    opacity: 0.8;
  }
</style>

<script lang="ts">
  /**
   * NekoBrowser — Renders browser view in Section D via noVNC iframe
   *
   * Connects to a headless Chrome instance running in a custom container
   * with Xvfb + x11vnc + noVNC. No authentication needed.
   * Both Gigi (agent via CDP) and user (via noVNC) share the same browser.
   */

  import { onMount } from 'svelte'

  let loading = $state(true)
  let browserUrl = $state('')
  let error = $state('')

  onMount(async () => {
    try {
      const res = await fetch('/api/browser/status')
      if (res.ok) {
        const data = await res.json()
        if (data.available) {
          browserUrl = data.browserUrl
        } else {
          error = 'Browser not available'
        }
      } else {
        error = 'Failed to check browser status'
      }
    } catch {
      error = 'Failed to connect to browser service'
    }
  })

  function onIframeLoad() {
    loading = false
  }
</script>

<div class="neko-frame-wrapper">
  {#if error}
    <div class="neko-frame-error">{error}</div>
  {:else}
    {#if loading}
      <div class="neko-frame-loading">Loading browser...</div>
    {/if}
    {#if browserUrl}
      <iframe
        src={browserUrl}
        title="Browser"
        class="neko-frame"
        class:loaded={!loading}
        onload={onIframeLoad}
        allow="autoplay; clipboard-read; clipboard-write"
      ></iframe>
    {/if}
  {/if}
</div>

<style>
  .neko-frame-wrapper {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .neko-frame {
    width: 100%;
    height: 100%;
    border: none;
    opacity: 0;
    transition: opacity 150ms ease;
  }

  .neko-frame.loaded {
    opacity: 1;
  }

  .neko-frame-loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--gigi-text-secondary);
    font-size: var(--gigi-font-size-sm);
  }

  .neko-frame-error {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-sm);
  }
</style>

<script lang="ts">
  /**
   * BrowserView — Renders shared browser in Section D via noVNC iframe
   *
   * Connects to a Chrome instance running in a custom container
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

<div class="browser-frame-wrapper">
  {#if error}
    <div class="browser-frame-error">{error}</div>
  {:else}
    {#if loading}
      <div class="browser-frame-loading">Loading browser...</div>
    {/if}
    {#if browserUrl}
      <iframe
        src={browserUrl}
        title="Browser"
        class="browser-frame"
        class:loaded={!loading}
        onload={onIframeLoad}
        allow="autoplay; clipboard-read; clipboard-write"
      ></iframe>
    {/if}
  {/if}
</div>

<style>
  .browser-frame-wrapper {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .browser-frame {
    width: 100%;
    height: 100%;
    border: none;
    opacity: 0;
    transition: opacity 150ms ease;
  }

  .browser-frame.loaded {
    opacity: 1;
  }

  .browser-frame-loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--gigi-text-secondary);
    font-size: var(--gigi-font-size-sm);
  }

  .browser-frame-error {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-sm);
  }
</style>

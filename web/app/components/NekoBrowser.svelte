<script lang="ts">
  /**
   * NekoBrowser — Renders neko browser stream in Section D via iframe
   *
   * Loads neko via same-origin proxy (/neko/) so we can inject CSS
   * to strip the UI down to just the video canvas + minimal controls.
   * Both Gigi (agent) and user share the same browser session.
   */

  import { onMount } from 'svelte'

  let iframe: HTMLIFrameElement
  let loading = $state(true)
  let nekoUrl = $state('')
  let error = $state('')

  // CSS injected into the neko iframe — hide chat, keep settings
  const embedCSS = `
    /* Hide chat panel and emoji picker */
    .chat, .chat-history, .chat-send,
    .neko-emoji, .emoji-menu { display: none !important; }
  `

  function injectStyles() {
    try {
      const doc = iframe?.contentDocument
      if (!doc) return
      if (doc.getElementById('gigi-neko-embed')) return
      const style = doc.createElement('style')
      style.id = 'gigi-neko-embed'
      style.textContent = embedCSS
      doc.head.appendChild(style)
    } catch {
      // Cross-origin — can't inject (will happen in production with external URL)
    }
  }

  onMount(async () => {
    try {
      const res = await fetch('/api/browser/status')
      if (res.ok) {
        const data = await res.json()
        if (data.available) {
          nekoUrl = data.nekoUrl
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
    injectStyles()
    // Re-inject after neko's SPA renders (Vue mounts asynchronously)
    setTimeout(injectStyles, 500)
    setTimeout(injectStyles, 1500)
  }
</script>

<div class="neko-frame-wrapper">
  {#if error}
    <div class="neko-frame-error">{error}</div>
  {:else}
    {#if loading}
      <div class="neko-frame-loading">Loading browser...</div>
    {/if}
    {#if nekoUrl}
      <iframe
        bind:this={iframe}
        src={nekoUrl}
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

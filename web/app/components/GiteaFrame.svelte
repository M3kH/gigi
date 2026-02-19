<script lang="ts">
  /**
   * GiteaFrame — Renders a Gitea page inside Section D via iframe
   *
   * Handles:
   * - Loading state
   * - postMessage bridge (listen for Gitea events)
   * - Navigation sync (update SPA route when iframe navigates)
   * - Polls iframe location to track in-iframe navigation for view context
   */

  import { onMount } from 'svelte'
  import { parseGiteaPath, setViewContext } from '$lib/stores/navigation.svelte'
  import { getTheme, type Theme } from '$lib/stores/theme.svelte'

  interface Props {
    src: string
  }

  let { src }: Props = $props()

  let iframe: HTMLIFrameElement
  let loading = $state(true)
  const currentTheme: Theme = $derived(getTheme())

  /** Push theme into the Gitea iframe via postMessage */
  function syncThemeToIframe() {
    try {
      iframe?.contentWindow?.postMessage({ type: 'gigi:theme', theme: currentTheme }, '*')
    } catch { /* cross-origin or iframe not ready */ }
  }

  // React to theme changes — push to iframe
  $effect(() => {
    if (currentTheme && iframe) {
      syncThemeToIframe()
    }
  })

  onMount(() => {
    const handleMessage = (e: MessageEvent) => {
      if (!e.data?.type?.startsWith('gitea:')) return

      if (e.data.type === 'gitea:loaded') {
        loading = false
      }
    }

    window.addEventListener('message', handleMessage)

    // Poll iframe location to detect in-iframe navigation (same-origin)
    let lastPath = ''
    const pollInterval = setInterval(() => {
      try {
        const path = iframe?.contentWindow?.location?.pathname
        if (path && path !== lastPath) {
          lastPath = path
          setViewContext(parseGiteaPath(path))
        }
      } catch {
        // Cross-origin or iframe not ready — ignore
      }
    }, 500)

    return () => {
      window.removeEventListener('message', handleMessage)
      clearInterval(pollInterval)
    }
  })

  function onIframeLoad() {
    loading = false
    // Sync theme immediately on iframe load
    syncThemeToIframe()
    // Also sync view context on full page load
    try {
      const path = iframe?.contentWindow?.location?.pathname
      if (path) {
        setViewContext(parseGiteaPath(path))
      }
    } catch {
      // Cross-origin — ignore
    }
  }
</script>

<div class="gitea-frame-wrapper">
  {#if loading}
    <div class="gitea-frame-loading">Loading...</div>
  {/if}
  <iframe
    bind:this={iframe}
    {src}
    title="Gitea"
    class="gitea-frame"
    class:loaded={!loading}
    onload={onIframeLoad}
  ></iframe>
</div>

<style>
  .gitea-frame-wrapper {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .gitea-frame {
    width: 100%;
    height: 100%;
    border: none;
    opacity: 0;
    transition: opacity 150ms ease;
  }

  .gitea-frame.loaded {
    opacity: 1;
  }

  .gitea-frame-loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--gigi-text-secondary);
    font-size: var(--gigi-font-size-sm);
  }
</style>

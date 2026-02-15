<script lang="ts">
  /**
   * Root Svelte component
   *
   * Gates the app behind setup: shows onboarding until Claude token
   * is configured, then renders the main app shell.
   */
  import { onMount } from 'svelte'
  import AppShell from '$components/AppShell.svelte'
  import Onboarding from '$components/Onboarding.svelte'
  import { checkSetup, isSetupLoading, isSetupComplete } from '$lib/stores/setup.svelte'

  const loading: boolean = $derived(isSetupLoading())
  const ready: boolean = $derived(isSetupComplete())

  onMount(() => {
    checkSetup()
  })
</script>

{#if loading}
  <div class="loading">
    <span class="dot"></span>
  </div>
{:else if ready}
  <AppShell />
{:else}
  <Onboarding />
{/if}

<style>
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: var(--gigi-bg-primary);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--gigi-text-muted);
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }
</style>

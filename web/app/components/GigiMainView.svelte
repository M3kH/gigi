<script lang="ts">
  /**
   * Section D: Main content area — View router
   *
   * Routes between:
   * - overview: Dashboard with repo summaries, stats, activity
   * - gitea: Gitea page rendered in iframe (issues, PRs, code explorer)
   */

  import { getCurrentView } from '$lib/stores/navigation.svelte'
  import OverviewDashboard from '$components/dashboard/OverviewDashboard.svelte'
  import GiteaFrame from '$components/GiteaFrame.svelte'

  const view = $derived(getCurrentView())
</script>

<main class="gigi-main-view">
  {#if view.view === 'overview'}
    <OverviewDashboard />
  {:else if view.view === 'gitea' && view.giteaPath}
    {#key view.giteaPath}
      <GiteaFrame src={view.giteaPath} />
    {/key}
  {/if}
</main>

<style>
  .gigi-main-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--gigi-bg-primary);
    overflow: hidden;
  }
</style>

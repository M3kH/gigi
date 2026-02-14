<script lang="ts">
  /**
   * Section D: Main content area — View router
   *
   * Routes between:
   * - Overview dashboard (default)
   * - Issue detail view
   * - Pull request detail view
   * - Repository explorer
   */

  import { getCurrentView } from '$lib/stores/navigation.svelte'
  import OverviewDashboard from '$components/dashboard/OverviewDashboard.svelte'
  import IssueDetail from '$components/detail/IssueDetail.svelte'
  import PullDetail from '$components/detail/PullDetail.svelte'
  import RepoExplorer from '$components/detail/RepoExplorer.svelte'

  const view = $derived(getCurrentView())
</script>

<main class="gigi-main-view">
  {#if view.view === 'overview'}
    <OverviewDashboard />
  {:else if view.view === 'issue'}
    {#key `${view.owner}/${view.repo}/${view.number}`}
      <IssueDetail />
    {/key}
  {:else if view.view === 'pull'}
    {#key `${view.owner}/${view.repo}/${view.number}`}
      <PullDetail />
    {/key}
  {:else if view.view === 'repo'}
    {#key `${view.owner}/${view.repo}`}
      <RepoExplorer />
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

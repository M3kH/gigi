<script lang="ts">
  /** Section D: Main content area */
</script>

<main class="gigi-main-view">
  <div class="welcome">
    <div class="logo">G</div>
    <h1>Gigi</h1>
    <p class="subtitle">Your persistent AI coordinator</p>
    <p class="hint">Start a conversation or select one from the sidebar</p>
  </div>
</main>

<style>
  .gigi-main-view {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--gigi-bg-primary);
    overflow-y: auto;
  }

  .welcome {
    text-align: center;
    padding: var(--gigi-space-2xl);
  }

  .logo {
    width: 64px;
    height: 64px;
    border-radius: var(--gigi-radius-lg);
    background: linear-gradient(135deg, var(--gigi-accent-green), var(--gigi-accent-blue));
    color: white;
    font-size: 2rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto var(--gigi-space-lg);
  }

  h1 {
    font-size: var(--gigi-font-size-xl);
    font-weight: 700;
    color: var(--gigi-text-primary);
    margin-bottom: var(--gigi-space-xs);
  }

  .subtitle {
    color: var(--gigi-text-secondary);
    font-size: var(--gigi-font-size-base);
    margin-bottom: var(--gigi-space-lg);
  }

  .hint {
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-sm);
  }
</style>

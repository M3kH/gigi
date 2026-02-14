<script lang="ts">
  /**
   * Drag handle for resizable panels
   *
   * Emits drag deltas on mousedown → mousemove → mouseup.
   */
  interface Props {
    ondragstart?: () => void
    ondragend?: () => void
    ondragmove?: (deltaX: number) => void
  }

  const { ondragstart, ondragend, ondragmove }: Props = $props()

  function handleMouseDown(e: MouseEvent) {
    e.preventDefault()
    const startX = e.clientX

    ondragstart?.()

    const onMove = (ev: MouseEvent) => {
      ondragmove?.(ev.clientX - startX)
    }

    const onUp = () => {
      ondragend?.()
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="drag-handle"
  onmousedown={handleMouseDown}
  role="separator"
  aria-orientation="vertical"
  tabindex="0"
></div>

<style>
  .drag-handle {
    width: var(--gigi-divider-width);
    cursor: col-resize;
    background: transparent;
    transition: background var(--gigi-transition-fast);
    flex-shrink: 0;
    position: relative;
  }

  .drag-handle::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 2px;
    height: 24px;
    background: var(--gigi-border-default);
    border-radius: var(--gigi-radius-full);
    opacity: 0;
    transition: opacity var(--gigi-transition-fast);
  }

  .drag-handle:hover {
    background: var(--gigi-accent-blue);
  }

  .drag-handle:hover::after {
    opacity: 1;
    background: var(--gigi-accent-blue);
  }
</style>

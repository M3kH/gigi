<script lang="ts">
  /**
   * Ask User block — renders a question from the agent with clickable options.
   * When no options are provided, shows a text input for free-form answers.
   */
  import type { AskUserBlock } from '$lib/types/chat'
  import { answerQuestion } from '$lib/stores/chat.svelte'

  interface Props {
    block: AskUserBlock
  }

  const { block }: Props = $props()

  let customAnswer = $state('')
  const isAnswered = $derived(block.answer !== undefined)

  function handleOption(option: string) {
    if (isAnswered) return
    answerQuestion(block.questionId, option)
  }

  function handleSubmit(e: Event) {
    e.preventDefault()
    if (isAnswered || !customAnswer.trim()) return
    answerQuestion(block.questionId, customAnswer.trim())
  }
</script>

<div class="ask-user" class:answered={isAnswered}>
  <div class="question-header">
    <span class="icon">?</span>
    <span class="label">Gigi needs your input</span>
  </div>

  <p class="question">{block.question}</p>

  {#if isAnswered}
    <div class="answered-badge">
      <span class="check">&#10003;</span> {block.answer}
    </div>
  {:else if block.options.length > 0}
    <div class="options">
      {#each block.options as option}
        <button class="option-btn" onclick={() => handleOption(option)}>
          {option}
        </button>
      {/each}
    </div>
    <form class="custom-input" onsubmit={handleSubmit}>
      <input
        type="text"
        bind:value={customAnswer}
        placeholder="Or type your own answer..."
      />
      <button type="submit" disabled={!customAnswer.trim()}>Send</button>
    </form>
  {:else}
    <form class="custom-input" onsubmit={handleSubmit}>
      <input
        type="text"
        bind:value={customAnswer}
        placeholder="Type your answer..."
        autofocus
      />
      <button type="submit" disabled={!customAnswer.trim()}>Send</button>
    </form>
  {/if}
</div>

<style>
  .ask-user {
    max-width: 720px;
    margin-bottom: var(--gigi-space-lg);
    border: 1px solid var(--gigi-accent-blue, #58a6ff);
    border-radius: var(--gigi-radius-md);
    padding: var(--gigi-space-md);
    background: color-mix(in srgb, var(--gigi-accent-blue, #58a6ff) 5%, var(--gigi-bg-secondary));
  }

  .ask-user.answered {
    opacity: 0.7;
    border-color: var(--gigi-border-muted);
    background: var(--gigi-bg-tertiary);
  }

  .question-header {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    margin-bottom: var(--gigi-space-sm);
    font-size: 0.7rem;
    color: var(--gigi-accent-blue, #58a6ff);
    font-weight: 500;
  }

  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--gigi-accent-blue, #58a6ff);
    color: var(--gigi-bg-primary);
    font-size: 0.65rem;
    font-weight: 700;
  }

  .question {
    margin: 0 0 var(--gigi-space-md) 0;
    font-size: var(--gigi-font-size-sm);
    line-height: 1.5;
    color: var(--gigi-text-primary);
  }

  .options {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gigi-space-sm);
    margin-bottom: var(--gigi-space-sm);
  }

  .option-btn {
    padding: 6px 14px;
    border: 1px solid var(--gigi-accent-blue, #58a6ff);
    border-radius: var(--gigi-radius-sm);
    background: transparent;
    color: var(--gigi-accent-blue, #58a6ff);
    font-size: var(--gigi-font-size-sm);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .option-btn:hover {
    background: color-mix(in srgb, var(--gigi-accent-blue, #58a6ff) 15%, transparent);
  }

  .custom-input {
    display: flex;
    gap: var(--gigi-space-sm);
  }

  .custom-input input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-sm);
    background: var(--gigi-bg-primary);
    color: var(--gigi-text-primary);
    font-size: var(--gigi-font-size-sm);
  }

  .custom-input input::placeholder {
    color: var(--gigi-text-muted);
  }

  .custom-input button {
    padding: 6px 12px;
    border: 1px solid var(--gigi-accent-blue, #58a6ff);
    border-radius: var(--gigi-radius-sm);
    background: var(--gigi-accent-blue, #58a6ff);
    color: var(--gigi-bg-primary);
    font-size: var(--gigi-font-size-sm);
    cursor: pointer;
  }

  .custom-input button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .answered-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--gigi-space-xs);
    padding: 4px 10px;
    border-radius: var(--gigi-radius-sm);
    background: color-mix(in srgb, var(--gigi-accent-green, #3fb950) 15%, transparent);
    color: var(--gigi-accent-green, #3fb950);
    font-size: var(--gigi-font-size-sm);
    font-weight: 500;
  }

  .check {
    font-size: 0.9em;
  }
</style>

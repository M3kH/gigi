/**
 * Tools module barrel export
 */

export { runGitea, giteaTool, agentTools as giteaAgentTools } from './gitea'
export type { GiteaInput } from './gitea'
export { runTelegram, setBotInstance, telegramTool, agentTools as telegramAgentTools } from './telegram'
export { default as browserTool, agentTools as browserAgentTools } from './browser'
export { BrowserManager, browserManager } from './browser-manager'

import { agentTools as giteaTools } from './gitea'
import { agentTools as telegramTools } from './telegram'
import { agentTools as browserTools } from './browser'
import { agentTools as askUserTools } from './ask-user'
import { agentTools as threadTools } from './threads'
import type { AgentTool } from '../core/registry'

/** All agent tools from the tools module */
export const agentTools: AgentTool[] = [
  ...giteaTools,
  ...telegramTools,
  ...browserTools,
  ...askUserTools,
  ...threadTools,
]

import { bashTool, runBash } from './bash.js'
import { gitTool, runGit } from './git.js'
import { giteaTool, runGitea } from './gitea.js'
import { fileTool, runFile } from './file.js'
import { dockerTool, runDocker } from './docker.js'
import { telegramTool, runTelegram } from './telegram.js'

export const tools = [
  bashTool,
  gitTool,
  giteaTool,
  fileTool,
  dockerTool,
  telegramTool
]

const runners = {
  bash: runBash,
  git: runGit,
  gitea: runGitea,
  read_file: runFile,
  docker: runDocker,
  telegram_send: runTelegram
}

export const executeTool = async (name, input) => {
  const runner = runners[name]
  if (!runner) return `Unknown tool: ${name}`
  try {
    return await runner(input)
  } catch (err) {
    return `Error: ${err.message}`
  }
}

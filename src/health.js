import { getConfig } from './store.js'

export const healthCheck = async () => {
  const status = { ok: true, checks: {} }

  // Database
  try {
    await getConfig('_health')
    status.checks.database = 'ok'
  } catch {
    status.checks.database = 'failed'
    status.ok = false
  }

  // Claude OAuth
  const oauthToken = await getConfig('claude_oauth_token').catch(() => null)
  status.checks.claude = oauthToken ? 'configured' : 'not_configured'

  // Telegram
  const tgToken = await getConfig('telegram_token').catch(() => null)
  status.checks.telegram = tgToken ? 'configured' : 'not_configured'

  // Gitea
  const giteaToken = await getConfig('gitea_token').catch(() => null)
  status.checks.gitea = giteaToken ? 'configured' : 'not_configured'

  // Phase
  if (!oauthToken) status.phase = 'setup'
  else if (!tgToken || !giteaToken) status.phase = 'partial'
  else status.phase = 'ready'

  return status
}

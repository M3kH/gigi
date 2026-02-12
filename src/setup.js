import { getConfig, setConfig, getAllConfig } from './store.js'
import { resetClient } from './agent.js'

export const getSetupStatus = async () => {
  const config = await getAllConfig()
  return {
    claude: !!config.claude_oauth_token,
    telegram: !!config.telegram_token && !!config.telegram_chat_id,
    gitea: !!config.gitea_url && !!config.gitea_token,
    complete: !!config.claude_oauth_token && !!config.telegram_token && !!config.gitea_token
  }
}

export const setupStep = async (step, data) => {
  switch (step) {
    case 'claude': {
      if (!data.token) return { ok: false, error: 'OAuth token required' }
      // Basic format check
      if (!data.token.startsWith('sk-ant-')) {
        return { ok: false, error: 'Token should start with sk-ant-. Run "claude setup-token" to get yours.' }
      }
      await setConfig('claude_oauth_token', data.token)
      resetClient()
      return { ok: true, message: 'OAuth token saved! I can think now.' }
    }

    case 'telegram': {
      if (!data.token) return { ok: false, error: 'Bot token required' }
      await setConfig('telegram_token', data.token)
      return {
        ok: true,
        message: 'Token saved. Now send /start to your bot on Telegram — I will capture your chat ID.'
      }
    }

    case 'gitea': {
      if (!data.url || !data.token) return { ok: false, error: 'URL and token required' }
      try {
        const res = await fetch(`${data.url}/api/v1/user`, {
          headers: { 'Authorization': `token ${data.token}` }
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const user = await res.json()
        await setConfig('gitea_url', data.url)
        await setConfig('gitea_token', data.token)
        return { ok: true, message: `Connected to Gitea as ${user.login}` }
      } catch (err) {
        return { ok: false, error: `Gitea connection failed: ${err.message}` }
      }
    }

    case 'webhook_secret': {
      if (!data.secret) return { ok: false, error: 'Secret required' }
      await setConfig('webhook_secret', data.secret)
      return { ok: true, message: 'Webhook secret saved' }
    }

    default:
      return { ok: false, error: `Unknown step: ${step}` }
  }
}

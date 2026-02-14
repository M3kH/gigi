/**
 * Domain Auth — authentication and credential types.
 */

export interface OAuthConfig {
  token: string
  expiresAt?: string
}

export interface GiteaCredentials {
  url: string
  token: string
}

export interface SetupStatus {
  claude: boolean
  telegram: boolean
  gitea: boolean
  webhookSecret: boolean
  complete: boolean
}

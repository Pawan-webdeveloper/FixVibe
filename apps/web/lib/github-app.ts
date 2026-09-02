import 'server-only'
import { createHmac, createSign, timingSafeEqual } from 'node:crypto'
import { serverEnv } from './env.ts'

export interface GitHubAppJwt {
  token: string
  expiresAt: number
}

function pem(privateKey: string): string {
  return privateKey.includes('\\n') ? privateKey.replace(/\\n/g, '\n') : privateKey
}

export function signAppJwt(): GitHubAppJwt {
  const appId = serverEnv.githubAppId
  if (!appId) throw new Error('GITHUB_APP_ID is not configured')
  const privateKey = pem(serverEnv.githubAppPrivateKey)
  if (!privateKey) throw new Error('GITHUB_APP_PRIVATE_KEY is not configured')

  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + 9 * 60
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { iat: now - 60, exp: expiresAt, iss: appId }
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url')
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signingInput = `${headerB64}.${payloadB64}`
  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  const signature = signer.sign(privateKey, 'base64url')
  return { token: `${signingInput}.${signature}`, expiresAt }
}

interface InstallationTokenResponse {
  token: string
  expires_at: string
}

export async function mintInstallationToken(installationId: number): Promise<InstallationTokenResponse> {
  const { token } = signAppJwt()
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'scanlyfix-web',
      },
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Could not mint installation token (${res.status}): ${body}`)
  }
  return (await res.json()) as InstallationTokenResponse
}

export async function getInstallationAccount(
  installationId: number,
): Promise<{ id: number; login: string; type: string }> {
  const { token } = signAppJwt()
  const res = await fetch(`https://api.github.com/app/installations/${installationId}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'scanlyfix-web',
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Could not read installation (${res.status}): ${body}`)
  }
  const data = (await res.json()) as { id: number; account?: { id: number; login: string; type: string } }
  if (!data.account) throw new Error('GitHub installation response missing account')
  return { id: data.account.id, login: data.account.login, type: data.account.type }
}

export interface InstallationRepo {
  id: number
  name: string
  full_name: string
  owner: { login: string }
  default_branch: string
  private: boolean
}

export async function listInstallationRepos(installationId: number): Promise<InstallationRepo[]> {
  const token = await mintInstallationToken(installationId)
  const repos: InstallationRepo[] = []
  let url: string | null = `https://api.github.com/installation/repositories?per_page=100`
  while (url) {
    const res: Response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'scanlyfix-web',
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Could not list installation repositories (${res.status}): ${body}`)
    }
    const data = (await res.json()) as { repositories: InstallationRepo[] }
    repos.push(...data.repositories)
    const link = res.headers.get('link')
    url = nextLink(link)
  }
  return repos
}

function nextLink(link: string | null): string | null {
  if (!link) return null
  for (const part of link.split(',')) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(part)
    if (match && match[1]) return match[1]
  }
  return null
}

export async function verifyWebhookSignature(
  body: string,
  signature: string | null,
): Promise<boolean> {
  const secret = serverEnv.githubWebhookSecret
  if (!secret || !signature) return false
  const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
  if (expected.length !== signature.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}

export type UpdateManifest = {
  version: string
  apkUrl: string
  sha256: string
  notes: string
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/
const SHA256 = /^[a-f0-9]{64}$/i

export function compareVersions(a: string, b: string): number {
  const left = a.match(SEMVER)?.slice(1).map(Number)
  const right = b.match(SEMVER)?.slice(1).map(Number)
  if (!left || !right) return 0
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  }
  return 0
}

export function parseUpdateManifest(value: unknown): UpdateManifest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  if (typeof data.version !== 'string' || !SEMVER.test(data.version)) return null
  if (typeof data.apkUrl !== 'string' || !/^https:\/\//.test(data.apkUrl)) return null
  if (typeof data.sha256 !== 'string' || !SHA256.test(data.sha256)) return null
  if (typeof data.notes !== 'string') return null
  return { version: data.version, apkUrl: data.apkUrl, sha256: data.sha256.toLowerCase(), notes: data.notes }
}

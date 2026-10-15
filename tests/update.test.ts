import { describe, expect, it } from 'vitest'
import { compareVersions, parseUpdateManifest } from '../src/engine/update'

describe('update manifest', () => {
  it('compares semantic versions safely', () => {
    expect(compareVersions('2.10.0', '2.9.0')).toBe(1)
    expect(compareVersions('2.9.0', '2.9.0')).toBe(0)
    expect(compareVersions('2.8.9', '2.9.0')).toBe(-1)
    expect(compareVersions('latest', '2.9.0')).toBe(0)
  })

  it('accepts a valid HTTPS manifest and rejects unsafe data', () => {
    const valid = parseUpdateManifest({ version: '2.10.0', apkUrl: 'https://example.com/game.apk', sha256: 'A'.repeat(64), notes: '修复' })
    expect(valid?.sha256).toBe('a'.repeat(64))
    expect(parseUpdateManifest({ version: '2.10.0', apkUrl: 'javascript:alert(1)', sha256: 'a'.repeat(64), notes: '' })).toBeNull()
    expect(parseUpdateManifest({ version: '2.10', apkUrl: 'https://example.com/game.apk', sha256: 'a'.repeat(64), notes: '' })).toBeNull()
  })
})

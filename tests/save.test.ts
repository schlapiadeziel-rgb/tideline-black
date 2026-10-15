import { describe, expect, it } from 'vitest'
import { defaultSave, insertScore, LEADERBOARD_SIZE, parseSave, SAVE_KEY, SaveStore } from '../src/engine/save'

describe('save', () => {
  it('falls back to defaults for missing, corrupt or foreign data', () => {
    expect(parseSave(null)).toEqual(defaultSave())
    expect(parseSave('{nope')).toEqual(defaultSave())
    expect(parseSave('[]')).toEqual(defaultSave())
    expect(parseSave(JSON.stringify({ version: 99, musicVolume: 0.1 }))).toEqual(defaultSave())
  })

  it('clamps and validates fields', () => {
    const s = parseSave(JSON.stringify({ version: 1, musicVolume: 5, sfxVolume: -1, locale: 'fr', quality: 'ultra', sensitivity: 9, playerName: '  a very long player name here ' }))
    expect(s.musicVolume).toBe(1)
    expect(s.sfxVolume).toBe(0)
    expect(s.locale).toBe('')
    expect(s.quality).toBe('high')
    expect(s.sensitivity).toBe(1)
    expect(s.playerName).toBe('a very long play')
  })

  it('migrates v1 saves and validates an active session snapshot', () => {
    const legacy = parseSave(JSON.stringify({ version: 1, locale: 'zh-CN', tutorialDone: true }))
    expect(legacy.version).toBe(2)
    expect(legacy.activeSession).toBeNull()
    const session = parseSave(JSON.stringify({
      version: 2,
      activeSession: {
        missionStage: 'deliver',
        playerPosition: [4, 1, 8],
        carPosition: [12, 0.5, 9],
        inVehicle: true,
        carYaw: 1,
        yaw: 0.4,
        pitch: 0.5,
        savedAt: 123,
        run: { phase: 'playing', timeLeft: 80, elapsed: 70, lives: 3, score: 120, collected: 0, total: 1, combo: 0, comboTimer: 0, invulnerable: 0, timeBonus: 0, lifeBonus: 0, unranked: false },
      },
    }))
    expect(session.activeSession?.missionStage).toBe('deliver')
    expect(session.activeSession?.inVehicle).toBe(true)
    expect(parseSave(JSON.stringify({ version: 2, activeSession: { missionStage: 'complete' } })).activeSession).toBeNull()
  })

  it('keeps a bounded, ordered leaderboard', () => {
    let board = [] as ReturnType<typeof defaultSave>['leaderboard']
    for (let i = 0; i < LEADERBOARD_SIZE + 3; i += 1) board = insertScore(board, { name: `p${i}`, score: i * 10, seconds: 60, at: i }).board
    expect(board).toHaveLength(LEADERBOARD_SIZE)
    expect(board[0].score).toBe((LEADERBOARD_SIZE + 2) * 10)
    const tie = insertScore(board, { name: 'fast', score: board[0].score, seconds: 30, at: 999 })
    expect(tie.rank).toBe(0)
    expect(insertScore(board, { name: 'low', score: 0, seconds: 1, at: 1 }).rank).toBe(-1)
  })

  it('persists through storage and survives storage errors', () => {
    const mem = new Map<string, string>()
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
    new SaveStore(storage).update({ musicVolume: 0.3, locale: 'zh-CN' })
    expect(JSON.parse(mem.get(SAVE_KEY)!).musicVolume).toBe(0.3)
    expect(new SaveStore(storage).data.locale).toBe('zh-CN')
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') } }
    const store = new SaveStore(broken)
    expect(() => store.update({ muted: true })).not.toThrow()
    expect(store.data.muted).toBe(true)
  })
})

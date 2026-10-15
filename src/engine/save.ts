/**
 * Versioned local save. Everything the player keeps between sessions lives in one JSON record so
 * it is easy to migrate. Corrupt or foreign data falls back to defaults instead of crashing.
 */
import type { RunState } from '../game/rules'

export type Locale = 'en' | 'zh-CN'
export type Quality = 'low' | 'medium' | 'high'
export type ScoreEntry = { name: string; score: number; seconds: number; at: number }
export type SavedMissionStage = 'idle' | 'pickup' | 'deliver'
export type SavedGameSession = {
  missionStage: SavedMissionStage
  playerPosition: [number, number, number]
  carPosition: [number, number, number]
  inVehicle: boolean
  carYaw: number
  yaw: number
  pitch: number
  run: RunState
  savedAt: number
}

export type SaveData = {
  version: 2
  locale: Locale | ''
  musicVolume: number
  sfxVolume: number
  muted: boolean
  sensitivity: number
  invertY: boolean
  quality: Quality
  reducedMotion: boolean
  tutorialDone: boolean
  playerName: string
  leaderboard: ScoreEntry[]
  activeSession: SavedGameSession | null
}

export const SAVE_KEY = 'game3d.save'
export const LEADERBOARD_SIZE = 10

export function defaultSave(): SaveData {
  return {
    version: 2,
    locale: '',
    musicVolume: 0.7,
    sfxVolume: 0.8,
    muted: false,
    sensitivity: 1,
    invertY: false,
    quality: 'high',
    reducedMotion: false,
    tutorialDone: false,
    playerName: 'PLAYER',
    leaderboard: [],
    activeSession: null,
  }
}

const clamp01 = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback
const finite = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? v : fallback
const vector3 = (value: unknown, fallback: [number, number, number]): [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3) return fallback
  return [finite(value[0], fallback[0]), finite(value[1], fallback[1]), finite(value[2], fallback[2])]
}

function parseActiveSession(value: unknown): SavedGameSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  if (data.missionStage !== 'idle' && data.missionStage !== 'pickup' && data.missionStage !== 'deliver') return null
  if (!data.run || typeof data.run !== 'object' || Array.isArray(data.run)) return null
  const rawRun = data.run as Record<string, unknown>
  if (rawRun.phase !== 'playing') return null
  const run: RunState = {
    unranked: rawRun.unranked === true,
    phase: 'playing',
    score: Math.max(0, Math.floor(finite(rawRun.score, 0))),
    lives: Math.max(0, Math.floor(finite(rawRun.lives, 3))),
    timeLeft: Math.max(0, finite(rawRun.timeLeft, 150)),
    elapsed: Math.max(0, finite(rawRun.elapsed, 0)),
    collected: Math.max(0, Math.floor(finite(rawRun.collected, 0))),
    total: Math.max(1, Math.floor(finite(rawRun.total, 1))),
    combo: Math.max(0, Math.floor(finite(rawRun.combo, 0))),
    comboTimer: Math.max(0, finite(rawRun.comboTimer, 0)),
    invulnerable: Math.max(0, finite(rawRun.invulnerable, 0)),
    timeBonus: Math.max(0, Math.floor(finite(rawRun.timeBonus, 0))),
    lifeBonus: Math.max(0, Math.floor(finite(rawRun.lifeBonus, 0))),
  }
  return {
    missionStage: data.missionStage,
    playerPosition: vector3(data.playerPosition, [5, 0.95, 11]),
    carPosition: vector3(data.carPosition, [13, 0.48, 11]),
    inVehicle: data.inVehicle === true,
    carYaw: finite(data.carYaw, 0.05),
    yaw: finite(data.yaw, 0.2),
    pitch: Math.min(1.12, Math.max(0.18, finite(data.pitch, 0.42))),
    run,
    savedAt: Math.max(0, finite(data.savedAt, 0)),
  }
}

/** Parse untrusted stored JSON into a valid SaveData (pure; unit tested). */
export function parseSave(raw: string | null): SaveData {
  const base = defaultSave()
  if (!raw) return base
  let data: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return base
    data = parsed as Record<string, unknown>
  } catch {
    return base
  }
  if (data.version !== 1 && data.version !== 2) return base
  const board = Array.isArray(data.leaderboard) ? data.leaderboard : []
  return {
    version: 2,
    locale: data.locale === 'en' || data.locale === 'zh-CN' ? data.locale : '',
    musicVolume: clamp01(data.musicVolume, base.musicVolume),
    sfxVolume: clamp01(data.sfxVolume, base.sfxVolume),
    muted: data.muted === true,
    sensitivity: typeof data.sensitivity === 'number' && data.sensitivity >= 0.2 && data.sensitivity <= 3 ? data.sensitivity : base.sensitivity,
    invertY: data.invertY === true,
    quality: data.quality === 'low' || data.quality === 'medium' || data.quality === 'high' ? data.quality : base.quality,
    reducedMotion: data.reducedMotion === true,
    tutorialDone: data.tutorialDone === true,
    playerName: typeof data.playerName === 'string' && data.playerName.trim() ? data.playerName.trim().slice(0, 16) : base.playerName,
    leaderboard: board
      .filter((e): e is ScoreEntry => !!e && typeof e === 'object' && typeof (e as ScoreEntry).name === 'string' && Number.isFinite((e as ScoreEntry).score))
      .map(e => ({ name: e.name.slice(0, 16), score: Math.max(0, Math.floor(e.score)), seconds: Number.isFinite(e.seconds) ? e.seconds : 0, at: Number.isFinite(e.at) ? e.at : 0 }))
      .slice(0, LEADERBOARD_SIZE),
    activeSession: data.version === 2 ? parseActiveSession(data.activeSession) : null,
  }
}

/** Insert a run into a bounded, deterministically ordered leaderboard (higher score, then faster, then earlier). */
export function insertScore(board: ScoreEntry[], entry: ScoreEntry): { board: ScoreEntry[]; rank: number } {
  const next = [...board, entry].sort((a, b) => b.score - a.score || a.seconds - b.seconds || a.at - b.at).slice(0, LEADERBOARD_SIZE)
  return { board: next, rank: next.indexOf(entry) }
}

export class SaveStore {
  data: SaveData

  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage) {
    let raw: string | null = null
    try {
      raw = this.storage?.getItem(SAVE_KEY) ?? null
    } catch {
      raw = null
    }
    this.data = parseSave(raw)
  }

  update(patch: Partial<SaveData>): void {
    this.data = { ...this.data, ...patch }
    try {
      this.storage?.setItem(SAVE_KEY, JSON.stringify(this.data))
    } catch {
      // Private browsing or quota: the game keeps working with in-memory settings.
    }
  }
}

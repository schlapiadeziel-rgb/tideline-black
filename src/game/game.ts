import * as THREE from 'three'
import type { Audio } from '../engine/audio'
import type { Input } from '../engine/input'
import type { Quality } from '../engine/save'
import type { Renderer } from '../engine/renderer'
import { CONFIG } from './config'
import { tuning } from './tuning'
import { createRun, tick, type RunState } from './rules'

export type Mode = 'attract' | 'playing' | 'paused' | 'ended'
export type Hint = 'move' | 'look' | 'jump' | 'dash' | 'cores'
export type Compass = { angle: number; distance: number; rise: number }
export type GameHooks = {
  popup(text: string, screen: { x: number; y: number }, kind: 'score' | 'hurt'): void
  hurt(): void
  hint(hint: Hint | null): void
  tutorialDone(): void
  end(run: RunState): void
}

type MissionStage = 'idle' | 'pickup' | 'deliver' | 'complete'
type Npc = { root: THREE.Group; phase: number; base: THREE.Vector3; speed: number }
type Traffic = { root: THREE.Group; axis: 'x' | 'z'; lane: number; progress: number; speed: number; direction: 1 | -1 }

const COLORS = {
  ink: '#101522',
  ocean: '#082b48',
  oceanGlow: '#0f6880',
  sand: '#f1c48c',
  asphalt: '#202b36',
  lane: '#f9d16a',
  concrete: '#657382',
  city: '#34495f',
  cityLight: '#45d2d0',
  coral: '#ff6f61',
  pink: '#e779bd',
  lime: '#c7f36b',
  gold: '#ffd35c',
  white: '#f8fbff',
}

export class Game {
  mode: Mode = 'attract'
  run: RunState = createRun(1)
  reducedMotion = false
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.1, 400)
  private readonly sun = new THREE.DirectionalLight('#ffe9ba', 3.2)
  private readonly hemi = new THREE.HemisphereLight('#c9f5ff', '#172334', 1.65)
  private readonly dawnSky = new THREE.Color('#071b35')
  private readonly daySky = new THREE.Color('#1b6381')
  private readonly skyColor = new THREE.Color()
  private readonly playerGroup = new THREE.Group()
  readonly player = {
    root: this.playerGroup,
    teleport: (position: THREE.Vector3) => {
      this.playerPosition.copy(position)
      this.playerGroup.position.copy(position)
      this.missionStage = 'deliver'
      this.compatibilityTeleport = true
    },
  }
  readonly cores = {
    remaining: () => [this.missionTargets.deliver.clone()],
  }
  private readonly playerBody: THREE.Group
  private readonly car: THREE.Group
  private readonly markerGroups = new Map<MissionStage | 'mission', THREE.Group>()
  private readonly npcs: Npc[] = []
  private readonly traffic: Traffic[] = []
  private readonly waterRipples: THREE.Mesh[] = []
  private readonly playerPosition = new THREE.Vector3(5, 0.95, 11)
  private readonly playerVelocity = new THREE.Vector3()
  private readonly carPosition = new THREE.Vector3(13, 0.48, 11)
  private readonly carVelocity = new THREE.Vector3()
  private readonly focus = new THREE.Vector3()
  private readonly missionTargets = {
    idle: new THREE.Vector3(3.5, 0, 8.5),
    pickup: new THREE.Vector3(-31, 0, 10),
    deliver: new THREE.Vector3(29, 0, 23),
    complete: new THREE.Vector3(29, 0, 23),
  }
  private missionStage: MissionStage = 'idle'
  private inVehicle = false
  private yaw = 0.2
  private pitch = 0.42
  private time = 0
  private simTime = 0
  private playerGrounded = true
  private jumpVelocity = 0
  private dashTimer = 0
  private compatibilityTeleport = false
  private customHud?: HTMLElement
  private hudMission?: HTMLElement
  private hudCopy?: HTMLElement
  private hudLocation?: HTMLElement
  private hudSpeed?: HTMLElement
  private hudPrompt?: HTMLElement

  constructor(
    private readonly renderer: Renderer,
    private readonly input: Input,
    private readonly audio: Audio,
    private readonly hooks: GameHooks,
  ) {
    this.scene.background = new THREE.Color('#0b263e')
    this.scene.fog = new THREE.Fog('#0b263e', 55, 180)
    this.scene.add(this.hemi)
    this.sun.position.set(-25, 50, 20)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(renderer.shadowMapSize, renderer.shadowMapSize)
    this.sun.shadow.camera.left = -70
    this.sun.shadow.camera.right = 70
    this.sun.shadow.camera.top = 70
    this.sun.shadow.camera.bottom = -70
    this.scene.add(this.sun)

    this.buildIsland()
    this.car = this.buildCar()
    this.scene.add(this.car)
    this.buildTraffic()
    this.playerBody = this.buildPlayer()
    this.playerGroup.add(this.playerBody)
    this.scene.add(this.playerGroup)
    this.buildMarkers()
    this.buildNpcs()
    this.applyAnimeStyle()
    this.ensureCustomHud()
    this.updateCamera(0)
  }

  start(tutorial: boolean): void {
    tuning.activate('run')
    this.mode = 'playing'
    this.missionStage = 'idle'
    this.inVehicle = false
    this.playerGroup.visible = true
    this.playerPosition.set(5, this.groundY(5, 11) + 0.95, 11)
    this.playerGroup.position.copy(this.playerPosition)
    this.playerVelocity.set(0, 0, 0)
    this.carPosition.set(13, this.groundY(13, 11) + 0.48, 11)
    this.car.position.copy(this.carPosition)
    this.car.rotation.y = 0.05
    this.run = createRun(1)
    this.yaw = 0.2
    this.pitch = 0.42
    this.playerGrounded = true
    this.jumpVelocity = 0
    this.setMissionMarker('mission', true)
    this.setMissionMarker('pickup', false)
    this.setMissionMarker('deliver', false)
    this.setMissionMarker('complete', false)
    this.setHudVisible(true)
    this.updateCustomHud()
    this.hooks.hint(tutorial ? 'move' : null)
    this.input.endFrame()
    this.input.takeLook()
  }

  pause(): void {
    if (this.mode === 'playing') this.mode = 'paused'
  }

  resume(): void {
    if (this.mode !== 'paused') return
    this.mode = 'playing'
    this.input.endFrame()
    this.input.takeLook()
  }

  toTitle(): void {
    this.mode = 'attract'
    this.setHudVisible(false)
    this.hooks.hint(null)
  }

  setQuality(quality: Quality): void {
    this.renderer.applyQuality(quality)
  }

  step(dt: number): void {
    this.simTime += dt
    const jumpPressed = this.input.consume('jump')
    const interactPressed = this.input.consume('interact')
    const dashPressed = this.input.consume('dash')

    if (this.mode !== 'playing') return
    this.run = tick(this.run, dt)
    if (this.run.phase === 'lost') {
      this.finishRun('lost')
      return
    }

    if (interactPressed) this.interact()
    if (this.inVehicle) this.drive(dt)
    else this.walk(dt, jumpPressed, dashPressed)

    if (this.compatibilityTeleport && this.playerPosition.distanceTo(this.missionTargets.deliver) < 2) {
      this.compatibilityTeleport = false
      this.interact()
    }

    if (!this.inVehicle && this.playerGrounded && jumpPressed) {
      this.jumpVelocity = CONFIG.player.jumpSpeed
      this.playerGrounded = false
      this.audio.play('jump')
    }
    this.animateActors(dt)
    this.updateCustomHud()
  }

  render(_alpha: number, frameSeconds: number): void {
    this.time += frameSeconds
    this.updateAtmosphere()
    if (this.mode === 'attract') {
      const t = this.time * 0.055
      this.camera.position.set(Math.sin(t) * 82, 40 + Math.sin(t * 0.7) * 4, Math.cos(t) * 82)
      this.camera.lookAt(0, 0, 0)
    } else {
      const look = this.mode === 'playing' ? this.input.takeLook() : { x: 0, y: 0 }
      if (this.mode === 'playing') {
        this.yaw -= look.x
        this.pitch = THREE.MathUtils.clamp(this.pitch - look.y, 0.18, 1.12)
      }
      this.updateCamera(frameSeconds)
    }
    this.renderer.render(this.scene, this.camera)
  }

  private updateAtmosphere(): void {
    const cycle = (Math.sin(this.time * 0.035 - 0.65) + 1) * 0.5
    const warmth = THREE.MathUtils.smoothstep(cycle, 0, 1)
    this.sun.intensity = 2.25 + warmth * 1.25
    this.sun.position.set(-28 + cycle * 36, 34 + warmth * 28, 18 - cycle * 20)
    this.sun.color.setHSL(0.095 - cycle * 0.035, 0.62, 0.78)
    this.hemi.intensity = 1.25 + warmth * 0.55
    this.hemi.color.setHSL(0.55, 0.55, 0.72 + warmth * 0.08)
    this.skyColor.copy(this.dawnSky).lerp(this.daySky, warmth)
    this.scene.background = this.skyColor
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.copy(this.skyColor)
  }

  private applyAnimeStyle(): void {
    this.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        if ('flatShading' in material) {
          material.flatShading = true
          material.needsUpdate = true
        }
        if ('color' in material) {
          const color = (material as THREE.MeshStandardMaterial).color
          const hsl = { h: 0, s: 0, l: 0 }
          color.getHSL(hsl)
          color.setHSL(hsl.h, Math.min(1, hsl.s * 1.28 + 0.06), Math.min(0.78, hsl.l * 1.08))
        }
        if ('roughness' in material) (material as THREE.MeshStandardMaterial).roughness = 0.72
      }
    })
  }

  compass(): Compass | null {
    if (this.missionStage === 'complete') return null
    const target = this.missionTargets[this.missionStage]
    const p = this.inVehicle ? this.carPosition : this.playerPosition
    const dx = target.x - p.x
    const dz = target.z - p.z
    const distance = Math.hypot(dx, dz)
    const angle = Math.atan2(-dx, -dz) - this.yaw
    return { angle: Math.atan2(Math.sin(angle), Math.cos(angle)), distance, rise: target.y - p.y }
  }

  project(world: THREE.Vector3): { x: number; y: number } {
    const v = world.clone().project(this.camera)
    const canvas = this.renderer.canvas
    return { x: ((v.x + 1) / 2) * canvas.clientWidth, y: ((1 - v.y) / 2) * canvas.clientHeight }
  }

  private walk(dt: number, _jumpPressed: boolean, dashPressed: boolean): void {
    const move = this.input.move
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw))
    const desired = forward.multiplyScalar(move.y).add(right.multiplyScalar(move.x))
    if (desired.lengthSq() > 1) desired.normalize()
    const speed = this.input.held('sprint') ? CONFIG.player.sprintSpeed : CONFIG.player.walkSpeed
    if (dashPressed && desired.lengthSq() > 0) {
      this.dashTimer = 0.22
      this.audio.play('dash')
    }
    const targetSpeed = this.dashTimer > 0 ? 21 : speed
    const target = desired.multiplyScalar(targetSpeed)
    this.playerVelocity.x = THREE.MathUtils.damp(this.playerVelocity.x, target.x, 12, dt)
    this.playerVelocity.z = THREE.MathUtils.damp(this.playerVelocity.z, target.z, 12, dt)
    this.playerPosition.x += this.playerVelocity.x * dt
    this.playerPosition.z += this.playerVelocity.z * dt
    this.clampToIsland(this.playerPosition)
    this.dashTimer = Math.max(0, this.dashTimer - dt)
    this.jumpVelocity += -30 * dt
    this.playerPosition.y += this.jumpVelocity * dt
    const ground = this.groundY(this.playerPosition.x, this.playerPosition.z) + 0.95
    if (this.playerPosition.y <= ground) {
      if (!this.playerGrounded && this.jumpVelocity < -7) this.audio.play('land')
      this.playerPosition.y = ground
      this.jumpVelocity = 0
      this.playerGrounded = true
    }
    this.playerGroup.position.copy(this.playerPosition)
    if (desired.lengthSq() > 0.01) this.playerGroup.rotation.y = Math.atan2(desired.x, desired.z)
  }

  private drive(dt: number): void {
    const move = this.input.move
    const steer = move.x * dt * (Math.abs(move.y) > 0.05 ? Math.sign(move.y) : 1) * 1.7
    this.car.rotation.y += steer
    const direction = new THREE.Vector3(Math.sin(this.car.rotation.y), 0, Math.cos(this.car.rotation.y))
    const desired = direction.multiplyScalar(move.y * 18)
    this.carVelocity.x = THREE.MathUtils.damp(this.carVelocity.x, desired.x, 4.5, dt)
    this.carVelocity.z = THREE.MathUtils.damp(this.carVelocity.z, desired.z, 4.5, dt)
    this.carPosition.x += this.carVelocity.x * dt
    this.carPosition.z += this.carVelocity.z * dt
    this.clampToIsland(this.carPosition)
    this.carPosition.y = this.groundY(this.carPosition.x, this.carPosition.z) + 0.48
    this.car.position.copy(this.carPosition)
    this.car.userData.speed = Math.round(this.carVelocity.length() * 3.6)
  }

  private interact(): void {
    const pos = this.inVehicle ? this.carPosition : this.playerPosition
    const target = this.missionTargets[this.missionStage]
    const atTarget = pos.distanceTo(target) <= 4.5
    if (this.inVehicle && !(this.missionStage === 'deliver' && atTarget)) {
      this.inVehicle = false
      this.playerGroup.visible = true
      this.playerPosition.set(this.carPosition.x + 1.8, this.groundY(this.carPosition.x + 1.8, this.carPosition.z) + 0.95, this.carPosition.z)
      this.playerGroup.position.copy(this.playerPosition)
      this.audio.play('ui')
      return
    }
    if (atTarget && this.missionStage === 'idle') {
      this.missionStage = 'pickup'
      this.setMissionMarker('mission', false)
      this.setMissionMarker('pickup', true)
      this.hooks.popup('任务已接收', this.project(target.clone().setY(2)), 'score')
      this.hooks.hint('cores')
      this.audio.play('pickup')
    } else if (atTarget && this.missionStage === 'pickup') {
      this.missionStage = 'deliver'
      this.setMissionMarker('pickup', false)
      this.setMissionMarker('deliver', true)
      this.hooks.popup('货物已装车', this.project(target.clone().setY(2)), 'score')
      this.audio.play('pickup')
    } else if (atTarget && this.missionStage === 'deliver') {
      this.missionStage = 'complete'
      this.setMissionMarker('deliver', false)
      this.setMissionMarker('complete', true)
      const timeBonus = Math.ceil(this.run.timeLeft) * 5
      this.run = { ...this.run, phase: 'won', collected: 1, score: 2500 + timeBonus, timeBonus, lifeBonus: 0 }
      this.hooks.popup('交付完成  +$' + this.run.score.toLocaleString('zh-CN'), this.project(target.clone().setY(2)), 'score')
      this.audio.play('win')
      this.finishRun('won')
    } else if (pos.distanceTo(this.carPosition) < 3.2) {
      this.inVehicle = true
      this.playerGroup.visible = false
      this.carVelocity.set(0, 0, 0)
      this.audio.play('ui')
    }
  }

  private finishRun(result: 'won' | 'lost'): void {
    this.mode = 'ended'
    this.setHudVisible(false)
    this.hooks.hint(null)
    if (result === 'lost') this.audio.play('lose')
    this.hooks.end(this.run)
  }

  private updateCamera(dt: number): void {
    const target = this.inVehicle ? this.carPosition : this.playerPosition
    const distance = this.inVehicle ? 8.2 : CONFIG.camera.distance + 1.2
    const height = this.inVehicle ? 3.1 : CONFIG.camera.height + 0.9
    const horizontal = Math.cos(this.pitch) * distance
    const desired = new THREE.Vector3(
      target.x - Math.sin(this.yaw) * horizontal,
      target.y + height + Math.sin(this.pitch) * distance,
      target.z + Math.cos(this.yaw) * horizontal,
    )
    this.camera.position.lerp(desired, 1 - Math.exp(-Math.max(dt, 0.016) * 8))
    this.focus.lerp(new THREE.Vector3(target.x, target.y + 1.2, target.z), 1 - Math.exp(-Math.max(dt, 0.016) * 10))
    this.camera.lookAt(this.focus)
  }

  private animateActors(dt: number): void {
    for (const npc of this.npcs) {
      npc.phase += dt * npc.speed
      npc.root.position.y = npc.base.y + Math.sin(npc.phase) * 0.06
      npc.root.rotation.y += dt * 0.18
    }
    for (const marker of this.markerGroups.values()) {
      if (!marker.visible) continue
      marker.rotation.y += dt * 0.8
      const beam = marker.children[1]
      if (beam) beam.scale.y = 0.88 + Math.sin(this.time * 3.5) * 0.12
    }
    this.car.children.forEach(child => {
      if (child.userData.wheel) child.rotation.x -= this.carVelocity.length() * dt * 2.2
    })
    for (const traffic of this.traffic) {
      traffic.progress += dt * traffic.speed * traffic.direction
      const span = 92
      const position = ((traffic.progress + span / 2) % span + span) % span - span / 2
      if (traffic.axis === 'x') {
        traffic.root.position.set(position, this.groundY(position, traffic.lane) + 0.48, traffic.lane)
        traffic.root.rotation.y = traffic.direction > 0 ? Math.PI / 2 : -Math.PI / 2
      } else {
        traffic.root.position.set(traffic.lane, this.groundY(traffic.lane, position) + 0.48, position)
        traffic.root.rotation.y = traffic.direction > 0 ? 0 : Math.PI
      }
      traffic.root.children.forEach(child => {
        if (child.userData.wheel) child.rotation.x -= traffic.speed * dt * 2.2
      })
    }
    for (const ripple of this.waterRipples) {
      const phase = ripple.userData.phase ?? 0
      const pulse = 1 + Math.sin(this.time * 0.9 + phase) * 0.18
      ripple.scale.set(1.8 * pulse, 0.62 * pulse, 1)
      ;(ripple.material as THREE.MeshBasicMaterial).opacity = 0.12 + (Math.sin(this.time * 0.9 + phase) + 1) * 0.04
    }
    this.playerBody.rotation.z = Math.sin(this.time * 8) * Math.min(0.05, this.playerVelocity.length() * 0.006)
  }

  private updateCustomHud(): void {
    if (!this.customHud) return
    const labels: Record<MissionStage, [string, string]> = {
      idle: ['零号货单', '去湾岸城南侧的蓝色信标，按 E 接活'],
      pickup: ['取货：旧工业港', '前往旧工业港，在仓库门口按 E 取货'],
      deliver: ['送达：月湾沙滩', '货物在车上，开到月湾沙滩的橙色信标'],
      complete: ['任务完成', '货单已安全交付，海岛今晚属于你'],
    }
    if (this.hudMission) this.hudMission.textContent = labels[this.missionStage][0]
    if (this.hudCopy) this.hudCopy.textContent = labels[this.missionStage][1]
    const progress = { idle: '16%', pickup: '42%', deliver: '74%', complete: '100%' }[this.missionStage]
    const progressBar = this.customHud.querySelector<HTMLElement>('.mission-line i')
    if (progressBar) progressBar.style.width = progress
    if (this.hudLocation) this.hudLocation.textContent = this.locationName()
    if (this.hudSpeed) this.hudSpeed.textContent = this.inVehicle ? `${this.car.userData.speed ?? 0} KM/H` : '步行'
    if (this.hudPrompt) {
      const pos = this.inVehicle ? this.carPosition : this.playerPosition
      let prompt = ''
      if (this.inVehicle && this.missionStage === 'deliver' && pos.distanceTo(this.missionTargets.deliver) < 4.5) prompt = 'E  交付'
      else if (this.inVehicle) prompt = 'E  下车'
      else if (this.missionStage !== 'complete' && pos.distanceTo(this.missionTargets[this.missionStage]) < 4.5) prompt = 'E  互动'
      else if (pos.distanceTo(this.carPosition) < 3.2) prompt = 'E  上车'
      this.hudPrompt.textContent = prompt
      this.hudPrompt.classList.toggle('is-visible', Boolean(prompt))
    }
  }

  private ensureCustomHud(): void {
    const root = document.getElementById('ui')
    if (!root) return
    const hud = document.createElement('div')
    hud.className = 'openworld-hud'
    hud.innerHTML = `
      <div class="location-chip"><span>当前位置</span><strong></strong></div>
      <div class="mission-card"><div class="mission-kicker">主线任务 · 潮汐线</div><strong class="mission-title"></strong><p class="mission-copy"></p><div class="mission-line"><i></i></div></div>
      <div class="vehicle-chip"><span>载具状态</span><strong class="vehicle-speed"></strong></div>
      <div class="interaction-prompt"></div>
    `
    root.append(hud)
    this.customHud = hud
    this.hudMission = hud.querySelector('.mission-title') ?? undefined
    this.hudCopy = hud.querySelector('.mission-copy') ?? undefined
    this.hudLocation = hud.querySelector('.location-chip strong') ?? undefined
    this.hudSpeed = hud.querySelector('.vehicle-speed') ?? undefined
    this.hudPrompt = hud.querySelector('.interaction-prompt') ?? undefined
  }

  private setHudVisible(visible: boolean): void {
    this.customHud?.classList.toggle('is-visible', visible)
  }

  private locationName(): string {
    const p = this.inVehicle ? this.carPosition : this.playerPosition
    if (p.x < -20 && p.z > -4) return '旧工业港'
    if (p.x > 17 && p.z > 10) return '月湾沙滩'
    if (p.x > 18 && p.z < -12) return '潮汐机场'
    if (p.z < -17) return '望潮山路'
    return '湾岸城'
  }

  private buildIsland(): void {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshStandardMaterial({ color: COLORS.ocean, roughness: 0.18, metalness: 0.15 }))
    water.rotation.x = -Math.PI / 2
    water.position.y = -1.55
    water.receiveShadow = true
    this.scene.add(water)
    for (let i = 0; i < 12; i += 1) {
      const ripple = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.76, 24), new THREE.MeshBasicMaterial({ color: COLORS.oceanGlow, transparent: true, opacity: 0.16, side: THREE.DoubleSide }))
      const angle = (i / 12) * Math.PI * 2
      const radius = 20 + (i % 4) * 9
      ripple.rotation.x = -Math.PI / 2
      ripple.position.set(Math.cos(angle) * radius, -1.48, Math.sin(angle) * radius)
      ripple.scale.set(1.8, 0.62, 1)
      ripple.userData.phase = i * 0.73
      this.waterRipples.push(ripple)
      this.scene.add(ripple)
    }
    const island = new THREE.Mesh(new THREE.CylinderGeometry(58, 63, 1.8, 64), new THREE.MeshStandardMaterial({ color: '#355f53', roughness: 0.94 }))
    island.position.y = -0.9
    island.receiveShadow = true
    island.castShadow = true
    this.scene.add(island)
    const sand = new THREE.Mesh(new THREE.RingGeometry(47, 59, 64), new THREE.MeshStandardMaterial({ color: COLORS.sand, roughness: 1 }))
    sand.rotation.x = -Math.PI / 2
    sand.position.y = 0.015
    this.scene.add(sand)

    this.addRoad(0, 0, 5, 105, 0)
    this.addRoad(0, 0, 110, 5, 0)
    this.addRoad(0, 18, 72, 3.8, 0)
    this.addRoad(-20, -20, 3.8, 55, 0.3)
    this.addRoad(18, -18, 3.8, 56, -0.8)
    this.addCity()
    this.addHarbor()
    this.addBeach()
    this.addAirport()
    this.addHill()
    this.addPalmClusters()
    this.addDistantIslets()
    this.addSkylineSign('湾岸城', new THREE.Vector3(0, 10, -16), COLORS.cityLight)
    this.addSkylineSign('旧工业港', new THREE.Vector3(-33, 5, 7), COLORS.coral)
    this.addSkylineSign('月湾', new THREE.Vector3(27, 5, 30), COLORS.gold)
  }

  private addRoad(x: number, z: number, width: number, depth: number, rotation: number): void {
    const road = new THREE.Mesh(new THREE.BoxGeometry(width, 0.12, depth), new THREE.MeshStandardMaterial({ color: COLORS.asphalt, roughness: 0.78 }))
    road.position.set(x, 0.08, z)
    road.rotation.y = rotation
    road.receiveShadow = true
    this.scene.add(road)
    const line = new THREE.Mesh(new THREE.BoxGeometry(Math.min(width * 0.08, 0.22), 0.025, depth * 0.88), new THREE.MeshBasicMaterial({ color: COLORS.lane }))
    line.position.set(x, 0.15, z)
    line.rotation.y = rotation
    this.scene.add(line)
  }

  private addCity(): void {
    const palette = ['#37445e', '#465a72', '#725b67', '#315b67', '#4d536d']
    const windowMaterial = new THREE.MeshStandardMaterial({ color: '#ffcf72', emissive: '#e98b4a', emissiveIntensity: 1.2, roughness: 0.35 })
    let index = 0
    for (let x = -22; x <= 22; x += 6) {
      for (let z = -12; z <= 12; z += 6) {
        if (Math.abs(x) < 4 || Math.abs(z) < 3 || (x > 8 && z > 4)) continue
        const h = 3.5 + ((index * 17) % 7)
        const w = 3.5 + ((index * 3) % 2)
        const color = palette[index % palette.length]
        const building = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshStandardMaterial({ color, roughness: 0.66, metalness: 0.18 }))
        building.position.set(x, h / 2 + 0.15, z)
        building.castShadow = true
        building.receiveShadow = true
        this.scene.add(building)
        const sign = new THREE.Mesh(new THREE.BoxGeometry(w * 0.82, 0.28, 0.05), new THREE.MeshStandardMaterial({ color: COLORS.cityLight, emissive: COLORS.cityLight, emissiveIntensity: 1.7 }))
        sign.position.set(x, h * 0.56, z - w / 2 - 0.03)
        this.scene.add(sign)
        for (const row of [0.34, 0.58]) {
          const windows = new THREE.Mesh(new THREE.BoxGeometry(w * 0.68, 0.12, 0.04), windowMaterial)
          windows.position.set(x, h * row, z - w / 2 - 0.06)
          this.scene.add(windows)
        }
        index += 1
      }
    }
  }

  private addHarbor(): void {
    const dock = new THREE.Mesh(new THREE.BoxGeometry(28, 0.5, 14), new THREE.MeshStandardMaterial({ color: '#776657', roughness: 0.8 }))
    dock.position.set(-34, 0.25, 10)
    this.scene.add(dock)
    for (let i = 0; i < 4; i += 1) {
      const warehouse = new THREE.Mesh(new THREE.BoxGeometry(5 + i % 2, 4 + (i % 2), 5), new THREE.MeshStandardMaterial({ color: i % 2 ? '#9a5a50' : '#657582', roughness: 0.8 }))
      warehouse.position.set(-44 + i * 7, 2.4, 2 + (i % 2) * 8)
      warehouse.castShadow = true
      this.scene.add(warehouse)
    }
    for (let i = 0; i < 5; i += 1) {
      const crane = new THREE.Group()
      crane.position.set(-45 + i * 6, 0, 16)
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.35, 9, 0.35), new THREE.MeshStandardMaterial({ color: COLORS.coral, metalness: 0.5 }))
      pole.position.y = 4.5
      const arm = new THREE.Mesh(new THREE.BoxGeometry(4, 0.25, 0.25), pole.material)
      arm.position.set(1.7, 8.7, 0)
      crane.add(pole, arm)
      this.scene.add(crane)
    }
  }

  private addBeach(): void {
    const bay = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 0.12, 32), new THREE.MeshStandardMaterial({ color: '#36a8b3', roughness: 0.2, metalness: 0.2 }))
    bay.scale.set(1.3, 1, 0.55)
    bay.position.set(29, 0.18, 25)
    this.scene.add(bay)
    for (let i = 0; i < 8; i += 1) {
      const umbrella = new THREE.Group()
      umbrella.position.set(19 + (i % 4) * 7, 0, 17 + Math.floor(i / 4) * 12)
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.1, 6), new THREE.MeshStandardMaterial({ color: '#f7f4e8' }))
      pole.position.y = 1.05
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.7, 10), new THREE.MeshStandardMaterial({ color: i % 2 ? COLORS.pink : COLORS.gold }))
      canopy.position.y = 2.15
      umbrella.add(pole, canopy)
      this.scene.add(umbrella)
    }
  }

  private addAirport(): void {
    const runway = new THREE.Mesh(new THREE.BoxGeometry(14, 0.1, 42), new THREE.MeshStandardMaterial({ color: '#343d4a', roughness: 0.75 }))
    runway.position.set(35, 0.08, -27)
    runway.rotation.y = -0.18
    this.scene.add(runway)
    for (let z = -45; z < -8; z += 6) {
      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.03, 2.5), new THREE.MeshBasicMaterial({ color: '#f7e9bd' }))
      mark.position.set(35, 0.16, z)
      mark.rotation.y = -0.18
      this.scene.add(mark)
    }
    const terminal = new THREE.Mesh(new THREE.BoxGeometry(16, 4, 7), new THREE.MeshStandardMaterial({ color: '#667a8b', metalness: 0.35, roughness: 0.4 }))
    terminal.position.set(48, 2, -22)
    terminal.castShadow = true
    this.scene.add(terminal)
    const glass = new THREE.Mesh(new THREE.BoxGeometry(16.1, 1.1, 0.15), new THREE.MeshStandardMaterial({ color: '#6df1e9', emissive: '#168c9b', emissiveIntensity: 1.4, metalness: 0.4 }))
    glass.position.set(48, 2.4, -25.5)
    this.scene.add(glass)
  }

  private addHill(): void {
    const hill = new THREE.Mesh(new THREE.ConeGeometry(15, 13, 32), new THREE.MeshStandardMaterial({ color: '#52715a', roughness: 1 }))
    hill.position.set(-6, 6.5, -28)
    hill.castShadow = true
    hill.receiveShadow = true
    this.scene.add(hill)
    const tower = new THREE.Group()
    tower.position.set(-6, 13, -28)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 7, 8), new THREE.MeshStandardMaterial({ color: '#d9e3dd', metalness: 0.6 }))
    pole.position.y = 3.5
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.65, 12, 8), new THREE.MeshStandardMaterial({ color: COLORS.coral, emissive: COLORS.coral, emissiveIntensity: 3 }))
    beacon.position.y = 7.2
    tower.add(pole, beacon)
    this.scene.add(tower)
  }

  private addPalmClusters(): void {
    for (let i = 0; i < 22; i += 1) {
      const angle = (i / 22) * Math.PI * 2
      const radius = 38 + (i % 4) * 3
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      if (z < -10 && x > 12) continue
      const tree = new THREE.Group()
      tree.position.set(x, 0, z)
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 3.8, 7), new THREE.MeshStandardMaterial({ color: '#8d5f44' }))
      trunk.position.y = 1.9
      tree.add(trunk)
      for (let leaf = 0; leaf < 6; leaf += 1) {
        const frond = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 2.4), new THREE.MeshStandardMaterial({ color: '#5aa968', roughness: 0.9 }))
        frond.position.y = 4
        frond.rotation.y = leaf * Math.PI / 3
        frond.rotation.x = -0.18 + (leaf % 2) * 0.15
        tree.add(frond)
      }
      this.scene.add(tree)
    }
  }

  private addDistantIslets(): void {
    for (let i = 0; i < 7; i += 1) {
      const a = i * Math.PI * 2 / 7
      const r = 82 + (i % 3) * 8
      const island = new THREE.Mesh(new THREE.CylinderGeometry(5 + (i % 3), 7 + (i % 3), 1.5, 14), new THREE.MeshStandardMaterial({ color: '#244e58', roughness: 1 }))
      island.position.set(Math.cos(a) * r, -1, Math.sin(a) * r)
      this.scene.add(island)
    }
  }

  private addSkylineSign(text: string, position: THREE.Vector3, color: string): void {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 128
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#101522'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = color
    ctx.lineWidth = 8
    ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12)
    ctx.fillStyle = color
    ctx.font = 'bold 54px ManusCC0 Sans CJK SC, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)
    const sprite = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.75), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }))
    sprite.position.copy(position)
    sprite.lookAt(this.camera.position)
    this.scene.add(sprite)
  }

  private buildPlayer(): THREE.Group {
    const root = new THREE.Group()
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.75, 5, 10), new THREE.MeshStandardMaterial({ color: '#eb806d', roughness: 0.65 }))
    body.position.y = 0.82
    body.castShadow = true
    const jacket = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.35), new THREE.MeshStandardMaterial({ color: '#182b43', roughness: 0.8 }))
    jacket.position.y = 0.68
    jacket.castShadow = true
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8), new THREE.MeshStandardMaterial({ color: '#c77961', roughness: 0.75 }))
    head.position.y = 1.55
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 12), new THREE.MeshStandardMaterial({ color: COLORS.gold }))
    cap.position.y = 1.79
    root.add(body, jacket, head, cap)
    return root
  }

  private buildCar(color = '#d84f59'): THREE.Group {
    const car = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.62, 4.2), new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.32 }))
    body.position.y = 0.62
    body.castShadow = true
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.62, 1.9), new THREE.MeshStandardMaterial({ color: '#15263b', metalness: 0.2, roughness: 0.25 }))
    cabin.position.set(0, 1.08, -0.15)
    cabin.castShadow = true
    car.add(body, cabin)
    for (const x of [-1.13, 1.13]) for (const z of [-1.25, 1.25]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.22, 14), new THREE.MeshStandardMaterial({ color: '#11151d', roughness: 0.7 }))
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(x, 0.38, z)
      wheel.userData.wheel = true
      car.add(wheel)
    }
    const light = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.12, 0.08), new THREE.MeshStandardMaterial({ color: COLORS.gold, emissive: '#ffd35c', emissiveIntensity: 1.8 }))
    light.position.set(0, 0.76, -2.1)
    car.add(light)
    return car
  }

  private buildMarkers(): void {
    const add = (key: MissionStage | 'mission', color: string, position: THREE.Vector3) => {
      const group = new THREE.Group()
      group.position.copy(position)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.09, 10, 32), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.1 }))
      ring.rotation.x = Math.PI / 2
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.42, 4.6, 12), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.7, transparent: true, opacity: 0.28 }))
      beam.position.y = 2.3
      const crown = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.3 }))
      crown.position.y = 4.7
      group.add(ring, beam, crown)
      this.scene.add(group)
      this.markerGroups.set(key, group)
    }
    add('mission', COLORS.lime, this.missionTargets.idle)
    add('pickup', COLORS.coral, this.missionTargets.pickup)
    add('deliver', COLORS.gold, this.missionTargets.deliver)
    add('complete', COLORS.lime, this.missionTargets.complete)
    this.markerGroups.get('pickup')!.visible = false
    this.markerGroups.get('deliver')!.visible = false
    this.markerGroups.get('complete')!.visible = false
  }

  private setMissionMarker(key: MissionStage | 'mission', visible: boolean): void {
    const marker = this.markerGroups.get(key)
    if (marker) marker.visible = visible
  }

  private buildNpcs(): void {
    const spots = [
      [0, 0, 10], [-12, 0, 8], [12, 0, -4], [21, 0, 14], [-27, 0, 12], [31, 0, -8], [3, 0, -8], [16, 0, 4],
    ]
    spots.forEach(([x, _y, z], index) => {
      const root = new THREE.Group()
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.5, 4, 8), new THREE.MeshStandardMaterial({ color: index % 2 ? '#5ad3cc' : '#e8788a' }))
      body.position.y = 0.55
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 7), new THREE.MeshStandardMaterial({ color: '#c27d63' }))
      head.position.y = 1.22
      root.add(body, head)
      const base = new THREE.Vector3(x, this.groundY(x, z), z)
      root.position.copy(base)
      this.scene.add(root)
      this.npcs.push({ root, base, phase: index * 0.8, speed: 0.55 + (index % 3) * 0.18 })
    })
  }

  private buildTraffic(): void {
    const routes: Array<[Traffic['axis'], number, number, number, Traffic['direction'], string]> = [
      ['x', 1.25, -28, 4.8, 1, '#2bd0c0'],
      ['x', -1.25, 18, 5.4, -1, '#f08b52'],
      ['z', 1.25, -36, 4.2, 1, '#738bff'],
      ['z', -1.25, 24, 5.1, -1, '#d95f8c'],
    ]
    for (const [axis, lane, progress, speed, direction, color] of routes) {
      const root = this.buildCar(color)
      root.position.y = 0.48
      this.scene.add(root)
      this.traffic.push({ root, axis, lane, progress, speed, direction })
    }
  }

  private groundY(x: number, z: number): number {
    const hillDistance = Math.hypot(x + 6, z + 28)
    const hill = hillDistance < 16 ? Math.max(0, (1 - hillDistance / 16) * 4.8) : 0
    return hill
  }

  private clampToIsland(position: THREE.Vector3): void {
    const radius = Math.hypot(position.x, position.z)
    if (radius > 54) {
      const scale = 54 / radius
      position.x *= scale
      position.z *= scale
    }
  }
}

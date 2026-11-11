// Types shared by the main process (device drivers) and the renderer (UI).

export type DeviceKind = 'mouse' | 'keyboard' | 'headset'
export type Capability = 'triggers' | 'sensor' | 'buttons' | 'profiles' | 'device' | 'actuation' | 'keymap' | 'advanced' | 'lighting' | 'audio'

export interface Hits {
  actuation: number // 1 (shallow) .. 10 (deep)
  rtLevel: number // rapid-trigger reset distance 1..5
  rtOn: boolean
  haptics: number // 0 (off) .. 5
}

export interface Stage {
  x: number // 0 = stage switched off
  y: number
  lod: number // lift-off distance 1 low .. 3 high
}

export interface ProfileData {
  sector: number
  fmt: number
  enabled: boolean
  rateHz: number
  rateWiredHz: number | null
  stages: Stage[]
  defaultStage: number
  shiftStage: number
  hits: Hits[] | null
  buttons: string[] // 4-byte actions as hex
  shiftButtons: string[]
  name: string
  angleSnap: boolean
  sleepS: number | null
  offS: number | null
  raw: string // the whole sector as hex; unknown bytes are kept
  /** Settings that only some mice have (Endgame Gear today). */
  extras?: MouseExtras
}

export interface MouseExtras {
  liftOffMm: number // 1 or 2
  debounceMs: number // 0..25
  motionSync: boolean
  rippleControl: boolean
  slamClickFilter: boolean
  jitterFilter: boolean
}

/** What a non-Logitech mouse can do; missing means "like a Logitech onboard profile". */
export interface MouseLimits {
  stages: number
  startStage: boolean
  shiftStage: boolean
  profiles: boolean
  functions: number[] // Logitech function ids the mouse supports
}

export interface Battery {
  percent: number
  status: string
  charging: boolean
}

export interface DpiGridData {
  values: number[]
  ranges: [number, number, number][] // [from, to, step]
}

export interface MouseState {
  profiles: ProfileData[]
  activeSector: number
  stage: number
  rates: number[]
  grid: DpiGridData
  hitsCaps: { actuation: number; rt: number; haptics: number } | null
  hasFactory: boolean
  firmware: string
  serial: string
  protocol: string
  onboard: { fmt: number; profiles: number; buttons: number; sectorSize: number } | null
  features: { index: number; id: number; hidden: boolean; version: number }[]
  limits?: MouseLimits
}

// ---------------------------------------------------------------- keyboards (Wooting)
export interface KeyboardSettings {
  actuationMm: number // 0.1 .. 4.0
  rapidTrigger: boolean
  rtPressMm: number // rapid-trigger sensitivity
  rtReleaseMm: number | null // separate release sensitivity, or null to use the press value
  continuousRt: boolean // stay in rapid trigger until the key is fully released
  tachyon: boolean
}

export interface AdvancedKey {
  key: number // matrix id
  kind: 'modTap' | 'toggle' | 'snapTap' | 'socd' | 'dks' | 'other'
  tap?: number
  hold?: number
  code?: number
  other?: number // the paired key for Snap Tap / SOCD
  mode?: number
  codes?: number[]
}

export interface KeyboardState {
  firmware: string
  serial: string
  model: string
  active: number
  profiles: { slot: number; name: string; settings: KeyboardSettings }[]
  layout: import('./wooting').KeyDef[]
  layers: number[][][] // [layer][row][col] Wooting key codes; layer 0 = base, 1 = Fn, 2 = Fn 2
  perKeyActuation: Record<number, number> // matrix id -> mm
  rtGroups: { keys: number[]; pressMm: number; releaseMm: number }[]
  advanced: AdvancedKey[]
  lighting: { brightness: number; colors: string[][]; effect: boolean; canRestoreEffect: boolean }
  backups: number
}

export type KeyboardAction =
  | { type: 'settings'; slot: number; settings: KeyboardSettings }
  | { type: 'activate'; slot: number }
  | { type: 'rename'; slot: number; name: string }
  | { type: 'perKey'; keys: number[]; actuationMm?: number | null; rt?: { pressMm: number; releaseMm: number } | null }
  | { type: 'map'; layer: number; keys: number[]; code: number | null } // null = back to default
  | { type: 'advanced'; key: number; entry: AdvancedKey | null }
  | { type: 'lighting'; brightness?: number; paint?: { keys: number[]; color: string }; effect?: 'static' | 'original' }
  | { type: 'restore' }
  | { type: 'reload' }

// ---------------------------------------------------------------- headsets (Fractal Scape)
export interface EqBand {
  type: 'peak' | 'lowShelf' | 'highShelf' | 'lowPass' | 'highPass' | 'notch' | 'bandPass'
  freq: number
  gain: number
  q: number
}

export interface HeadsetState {
  dongleFirmware: string
  headsetFirmware: string
  serial: string
  connected: boolean
  battery: number | null
  boomMic: boolean
  muted: boolean
  eqSlot: number
  presets: { slot: number; bands: EqBand[] }[]
  sidetone: boolean
  sidetoneLevel: number
  noiseCancelling: boolean
  lighting: boolean
}

export type HeadsetPatch = Partial<Pick<HeadsetState, 'eqSlot' | 'sidetone' | 'noiseCancelling' | 'lighting' | 'sidetoneLevel'>> & {
  /** write bands into an EQ slot; `live` previews without saving */
  eq?: { slot: number; bands: EqBand[]; live?: boolean }
  /** forget a slot's custom EQ (slots 2 and 3 fall back to their factory preset) */
  eraseEq?: number
}

/** ready: configurable now · asleep: paired but not answering · inactive: seen before, not plugged in ·
 *  unsupported: plugged in, but Hubless has no driver for it yet */
export type DeviceStatus = 'ready' | 'asleep' | 'inactive' | 'unsupported'

/** One entry of the built-in mouse catalog (data/mice.json). */
export interface CatalogModel {
  vendor: string
  name: string
  kind: string
  protocol: string // razer, logitech-hidpp20, steelseries, sinowealth, asus, endgame, …
  maxDpi: number | null
  ids: { vid: number; pid: number; connection: string | null }[]
  popular: boolean
  verified: boolean
  source: string
}

export interface DeviceSummary {
  id: string
  kind: DeviceKind
  vendor: string
  name: string
  connection: string
  status: DeviceStatus
  battery: Battery | null
  capabilities: Capability[]
  verified: boolean
  demo: boolean
  lastSeen: number
  /** overrides the status line on the home card, e.g. "Headset off" */
  note?: string
  /** what the built-in catalog knows about this model */
  model?: Pick<CatalogModel, 'protocol' | 'maxDpi' | 'popular'>
}

export interface AppSnapshot {
  devices: DeviceSummary[]
  missingPermission: string[] // vendors we can see but not open
  asleep: string[] // paired devices that aren't answering
  searching: boolean
}

export interface BackupInfo {
  path: string
  created: number
  label: string
}

/** Everything the renderer may call (exposed by the preload script as window.hubless). */
export interface HublessApi {
  snapshot(): Promise<AppSnapshot>
  mouseState(id: string): Promise<MouseState>
  saveProfile(id: string, profile: ProfileData): Promise<MouseState>
  previewHits(id: string, hits: Hits[]): Promise<void>
  /** start/stop the live HITS button-depth stream */
  watchDepth(id: string, on: boolean): Promise<void>
  onDepth(cb: (id: string, left: number, right: number) => void): () => void
  activateProfile(id: string, sector: number): Promise<MouseState>
  setProfileEnabled(id: string, slot: number, enabled: boolean): Promise<MouseState>
  replaceProfile(id: string, sector: number, source: 'factory' | { fromSector: number } | { raw: string }): Promise<MouseState>
  backup(id: string): Promise<string>
  listBackups(id: string): Promise<BackupInfo[]>
  restoreBackup(id: string, path: string): Promise<MouseState>
  openBackupsFolder(id: string): Promise<void>
  exportProfile(id: string, sector: number): Promise<string | null>
  importProfile(id: string, sector: number): Promise<MouseState | null>
  grantAccess(): Promise<{ ok: boolean; message: string }>
  forgetDevice(id: string): Promise<void>
  appSettings(): Promise<AppSettings>
  setAppSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  keyboardState(id: string): Promise<KeyboardState>
  keyboardAction(id: string, action: KeyboardAction): Promise<KeyboardState>
  /** live travel of every key, rows × columns, 0..255 over 0..4 mm */
  keyboardAnalog(id: string): Promise<number[][]>
  headsetState(id: string): Promise<HeadsetState>
  setHeadset(id: string, patch: HeadsetPatch): Promise<HeadsetState>
  /** Custom card photos the user picked, as data URLs keyed by device id. */
  deviceImages(): Promise<Record<string, string>>
  chooseDeviceImage(id: string): Promise<string | null>
  clearDeviceImage(id: string): Promise<void>
  /** version and license, for the About section */
  appInfo(): Promise<{ version: string; license: string }>
  /** the shipped privacy statement or third-party notices, as Markdown text */
  readDocument(name: 'privacy' | 'licenses'): Promise<string>
  /** remove settings, device list, photos, backups and the autostart entry, then restart fresh */
  deleteAllData(): Promise<void>
  onChange(cb: (snap: AppSnapshot) => void): () => void
  /** physical button state of a mouse (bit 0 left, 1 right, 2 middle, 3 back, 4 forward) */
  onButtons(cb: (id: string, mask: number) => void): () => void
}

export interface AppSettings {
  /** keep running in the tray when the window is closed (needed for battery alerts) */
  runInTray: boolean
  /** start hidden in the tray when you log in */
  startOnLogin: boolean
  /** notify when a device's battery drops to this % (0 = off) */
  lowBattery: number
}

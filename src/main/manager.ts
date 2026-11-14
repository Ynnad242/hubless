// Finds devices, keeps their sessions alive across sleep and unplugging, remembers devices seen before,
// and tells the UI what changed. One driver per family: Logitech HID++ mice, Wooting keyboards, Fractal Scape.
import { accessSync, constants, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { homedir, release } from 'node:os'
import { basename, join } from 'node:path'
import HID from 'node-hid'
import type { AppSnapshot, DeviceKind, DeviceSummary } from '@shared/types'
import { modelKey } from '@shared/devices'
import { lookup } from './catalog'
import { EG_VID, EndgameSession, EndgameTransport, MODELS as EG_MODELS, endgameEndpoint } from './endgame/op1'
import { MODELS as WL_MODELS, WlSession, WlTransport, wlmouseEndpoint } from './wlmouse/ying'
import { HidLink, MODELS as RAZER_MODELS, RazerSession, RazerTransport, razerEndpoint } from './razer/razer'
import { SimRazer } from './razer/sim'
import { ScapeSession, ScapeTransport, scapeEndpoint } from './fractal/scape'
import { LogitechDevice } from './logitech/device'
import { HidrawTransport, Offline, Timeout, endpoints, type Transport } from './logitech/hidpp'
import { LogitechSession } from './logitech/session'
import { SimTransport } from './logitech/sim'
import { VENDORS } from './storage'
import { WootingSession, WootingTransport, wootingEndpoint } from './wooting/wooting'

HID.setDriverType('hidraw')

const CONFIG = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'hubless')
const REGISTRY = join(CONFIG, 'devices.json')

type Live =
  | { kind: 'logitech'; summary: DeviceSummary; path: string; session: LogitechSession }
  | { kind: 'wooting'; summary: DeviceSummary; path: string; session: WootingSession }
  | { kind: 'scape'; summary: DeviceSummary; path: string; session: ScapeSession }
  | { kind: 'endgame'; summary: DeviceSummary; path: string; session: EndgameSession }
  | { kind: 'wlmouse'; summary: DeviceSummary; path: string; session: WlSession }
  | { kind: 'razer'; summary: DeviceSummary; path: string; session: RazerSession }

/** Any mouse the mouse pages can edit. */
export type MouseSession = LogitechSession | EndgameSession | WlSession | RazerSession

/** Peripherals recognised before (or without) a driver. */
const KNOWN: { vid: number; pid?: number; kind: DeviceKind; vendor: string; name?: string }[] = [
  { vid: 0x31e3, kind: 'keyboard', vendor: 'Wooting' },
  { vid: 0x36bc, pid: 0x0001, kind: 'headset', vendor: 'Fractal Design', name: 'Scape' },
  { vid: 0x1532, kind: 'mouse', vendor: 'Razer' },
  { vid: 0x3367, kind: 'mouse', vendor: 'Endgame Gear' }
]

const canOpen = (path: string) => {
  try {
    accessSync(path, constants.R_OK | constants.W_OK)
    return true
  } catch {
    return false
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const cleanName = (product: string, vendor: string) =>
  product.replace(new RegExp(`^(${vendor.split(' ')[0]}\\s*)+`, 'i'), '').replace(/\s*\(ARM\)|\s+Dongle$/i, '').trim() || product
const wpidOf = (slots: { slot: number; wpid: number }[], slot: number) => slots.find((x) => x.slot === slot)?.wpid ?? 0
const isMouse = (e: Live): e is Extract<Live, { session: MouseSession }> => ['logitech', 'endgame', 'wlmouse', 'razer'].includes(e.kind)
const offline = (e: unknown) => e instanceof Offline || e instanceof Timeout

export class DeviceManager extends EventEmitter {
  private live = new Map<string, Live>()
  private transports = new Map<string, Transport>()
  private asleepIds = new Map<string, DeviceSummary>()
  private unsupported = new Map<string, DeviceSummary>()
  /** Mice whose driver refused them (answers it didn't expect): shown with the reason, not retried every scan. */
  private refused = new Map<string, string>()
  /** Catalog model of a Logitech mouse, found by USB id: names its shipped photo, since the name the mouse reports
   *  ("G203 LIGHTSYNC Gaming Mouse") often differs from the catalog's. */
  private photoKeys = new Map<string, string>()
  /** Wireless id of a Logitech mouse behind a receiver (fwupd lists such mice by it). */
  private wpids = new Map<string, number>()
  /** Devices Hubless has let go of (firmware update running, or Wootility has the keyboard): their USB ids are
   *  left alone until released, and the card shows what's going on. */
  private held = new Map<string, { usb: Set<string>; summary: DeviceSummary; parked: Live[] }>()
  private known = new Map<string, DeviceSummary>()
  private missingPermission: string[] = []
  private searching = true
  private scanning = false
  private timer: NodeJS.Timeout | null = null
  private tick = 0
  sim: SimTransport | null = null

  constructor(private demo = false) {
    super()
    if (!demo) {
      try {
        for (const d of JSON.parse(readFileSync(REGISTRY, 'utf8')) as DeviceSummary[]) this.known.set(d.id, d)
      } catch {
        /* first run */
      }
    }
  }

  start() {
    void this.scan()
    this.timer = setInterval(() => void this.poll(), 2000)
  }

  stop() {
    // Devices still plugged in were in use until now.
    if (!this.demo && !this.frozen && this.live.size) {
      for (const id of this.live.keys()) {
        const k = this.known.get(id)
        if (k) this.known.set(id, { ...k, lastSeen: Date.now() })
      }
      try {
        writeFileSync(REGISTRY, JSON.stringify([...this.known.values()], null, 1))
      } catch {
        /* config folder gone (data deleted): nothing to keep */
      }
    }
    if (this.timer) clearInterval(this.timer)
    for (const d of this.buttonStreams.values()) d.close().catch(() => {})
    for (const t of this.transports.values()) t.close()
    for (const e of this.live.values()) if (e.kind !== 'logitech') e.session.t.close()
  }

  // ---------------------------------------------------------------- registry
  private frozen = false

  /** Stop polling and stop writing the device list (used right before all app data is deleted). */
  freeze() {
    this.frozen = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private remember(d: DeviceSummary) {
    if (this.demo || this.frozen) return
    const prev = this.known.get(d.id)
    if (prev && prev.name === d.name && prev.capabilities.length === d.capabilities.length && Date.now() - prev.lastSeen < 60_000) return
    this.known.set(d.id, { ...d, battery: null, status: 'inactive', note: undefined, lastSeen: Date.now() })
    mkdirSync(CONFIG, { recursive: true })
    writeFileSync(REGISTRY, JSON.stringify([...this.known.values()], null, 1))
  }

  /** Mark a remembered device as used just now (it was connected until this moment). */
  private touch(id: string) {
    const k = this.known.get(id)
    if (this.demo || this.frozen || !k) return
    this.known.set(id, { ...k, lastSeen: Date.now() })
    mkdirSync(CONFIG, { recursive: true })
    writeFileSync(REGISTRY, JSON.stringify([...this.known.values()], null, 1))
  }

  /**
   * A read-only report about one device for a GitHub issue: model, USB ids and interfaces, HID report descriptors,
   * firmware and the raw settings Hubless read. Nothing is sent to the device; serial numbers and paths are left out.
   */
  report(id: string, appVersion: string) {
    const e = this.live.get(id)
    const d = e?.summary ?? this.unsupported.get(id) ?? this.known.get(id)
    if (!d) throw new Error('That device is not known.')
    const hid = this.hid.length ? this.hid : HID.devices()
    const usb = e ? hid.find((x) => x.path === e.path) : hid.find((x) => id.endsWith(`-${x.productId.toString(16).padStart(4, '0')}`) && slug(d.vendor) === id.slice(0, id.lastIndexOf('-')))
    const hex = (b: ArrayLike<number>) => Buffer.from(Array.from(b)).toString('hex')
    const lines = [
      '### Hubless device report',
      '',
      `- Hubless ${appVersion}, Linux ${release()}`,
      `- Device: ${d.vendor} ${d.name}, ${d.status}${d.connection ? `, ${d.connection}` : ''}${e ? `, driver: ${e.kind}` : ', no driver'}${d.verified ? ', verified' : ''}`
    ]
    if (usb) {
      const vp = `${usb.vendorId.toString(16).padStart(4, '0')}:${usb.productId.toString(16).padStart(4, '0')}`
      lines.push(`- USB id: \`${vp}\` (${usb.manufacturer ?? '?'} / ${usb.product ?? '?'})`, '', '| Interface | Usage page:usage | Report descriptor |', '|---|---|---|')
      const seen = new Set<string>()
      for (const x of hid.filter((y) => y.vendorId === usb.vendorId && y.productId === usb.productId)) {
        let desc = ''
        if (x.path && !seen.has(x.path)) {
          seen.add(x.path)
          try {
            desc = hex(readFileSync(`/sys/class/hidraw/${basename(x.path)}/device/report_descriptor`))
          } catch {
            desc = '(unreadable)'
          }
        }
        lines.push(`| ${x.interface} | ${(x.usagePage ?? 0).toString(16)}:${(x.usage ?? 0).toString(16)} | ${desc ? `\`${desc}\`` : '″'} |`)
      }
    }
    if (e && (e.kind === 'razer' || e.kind === 'wlmouse' || e.kind === 'endgame')) {
      const s = e.session
      lines.push('', `- Firmware: ${s.fw || '?'}`)
      if (e.kind === 'razer') lines.push(`- Razer model: ${e.session.model.id}, transaction id 0x${e.session.model.dpi![2].toString(16)}`)
      const readings = e.kind === 'endgame' ? { config: e.session.config } : (s as RazerSession | WlSession).readings
      for (const [k, v] of Object.entries(readings)) if (v) lines.push(`- ${k}: \`${hex(v).replace(/(00)+$/, '')}\``)
    }
    return lines.join('\n') + '\n'
  }

  forget(id: string) {
    this.known.delete(id)
    writeFileSync(REGISTRY, JSON.stringify([...this.known.values()], null, 1))
    this.changed()
  }

  snapshot(): AppSnapshot {
    const shown = new Map<string, DeviceSummary>()
    for (const e of this.live.values()) shown.set(e.summary.id, e.summary)
    for (const [id, d] of this.asleepIds) if (!shown.has(id)) shown.set(id, d)
    for (const [id, h] of this.held) if (!shown.has(id)) shown.set(id, h.summary)
    for (const [id, d] of this.unsupported) if (!shown.has(id)) shown.set(id, d)
    for (const [id, d] of this.known) if (!shown.has(id)) shown.set(id, { ...d, status: 'inactive', battery: null, note: undefined })
    // Stable order: a device must not jump around when it falls asleep or wakes up (status changes all the time
    // while the user is away), so status only separates plugged-in devices from remembered ones.
    const order = { ready: 0, asleep: 0, unsupported: 0, inactive: 1 }
    const kinds = { mouse: 0, keyboard: 1, headset: 2 }
    return {
      devices: [...shown.values()].sort((a, b) => order[a.status] - order[b.status] || kinds[a.kind] - kinds[b.kind] || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      missingPermission: this.missingPermission,
      asleep: [...this.asleepIds.values()].map((d) => d.name),
      searching: this.searching
    }
  }

  private lastSent = ''

  /** Tell the UI, but only when something it shows actually changed (timestamps aside). */
  private changed() {
    const snap = this.snapshot()
    const key = JSON.stringify(snap, (k, v) => (k === 'lastSeen' ? undefined : v))
    if (key === this.lastSent) return
    this.lastSent = key
    this.emit('changed', snap)
  }

  // ---------------------------------------------------------------- summaries
  private mouseSummary(id: string, s: LogitechSession, status: DeviceSummary['status'] = 'ready'): DeviceSummary {
    const d = s.dev
    const caps: DeviceSummary['capabilities'] = []
    if (s.hitsCaps) caps.push('triggers')
    if (s.editable) caps.push('sensor', 'buttons', 'profiles')
    if (s.zones.length) caps.push('lighting')
    caps.push('device')
    return {
      id, kind: 'mouse', vendor: 'Logitech', name: d.name, photo: this.photoKeys.get(id), status, battery: s.battery,
      connection: this.demo ? 'Demo' : d.index === 0xff ? 'USB cable' : 'LIGHTSPEED wireless',
      capabilities: caps, verified: s.verified, demo: this.demo, lastSeen: Date.now()
    }
  }

  private keyboardSummary(id: string, s: WootingSession): DeviceSummary {
    return {
      id, kind: 'keyboard', vendor: 'Wooting', name: s.name, status: 'ready', battery: null, connection: 'USB cable',
      capabilities: ['actuation', 'keymap', 'advanced', 'lighting', 'device'], verified: true, demo: false, lastSeen: Date.now()
    }
  }

  private endgameSummary(id: string, s: EndgameSession): DeviceSummary {
    return {
      id, kind: 'mouse', vendor: 'Endgame Gear', name: s.name, status: 'ready', battery: null, connection: 'USB cable',
      capabilities: ['sensor', 'buttons', 'device'], verified: true, demo: false, lastSeen: Date.now()
    }
  }

  private wlSummary(id: string, s: WlSession): DeviceSummary {
    return {
      id, kind: 'mouse', vendor: 'WLmouse', name: s.name, status: 'ready', battery: null, connection: 'USB cable',
      capabilities: ['sensor', 'device'], verified: true, demo: false, lastSeen: Date.now()
    }
  }

  private razerSummary(id: string, s: RazerSession, status: DeviceSummary['status'] = 'ready'): DeviceSummary {
    return {
      id, kind: 'mouse', vendor: 'Razer', name: s.name, status, battery: s.battery,
      connection: s.model.wireless ? 'HyperSpeed wireless' : 'USB cable',
      capabilities: s.model.lighting.length ? ['sensor', 'lighting', 'device'] : ['sensor', 'device'], verified: false, demo: false, lastSeen: Date.now()
    }
  }

  private headsetSummary(id: string, s: ScapeSession): DeviceSummary {
    const st = s.state
    return {
      id, kind: 'headset', vendor: 'Fractal Design', name: 'Scape', connection: '2.4 GHz wireless',
      status: st.connected ? 'ready' : 'asleep', note: st.connected ? undefined : 'Headset off · dongle connected',
      battery: st.battery === null ? null : { percent: st.battery, status: '', charging: false },
      capabilities: ['audio', 'device'], verified: true, demo: false, lastSeen: Date.now()
    }
  }

  // ---------------------------------------------------------------- discovery
  async scan(list: HID.Device[] = HID.devices()) {
    this.hid = list
    if (this.scanning) return
    this.scanning = true
    try {
      if (this.demo) return await this.scanDemo()
      const hid = list
      const missing = new Set<string>()
      for (const [vid, name] of Object.entries(VENDORS)) {
        const paths = hid.filter((d) => d.vendorId === parseInt(vid, 16) && d.path).map((d) => d.path!)
        if (paths.length && paths.every((p) => !canOpen(p))) missing.add(name)
      }
      await this.scanKeyboard(hid)
      await this.scanHeadset(hid)
      await this.scanEndgame(hid)
      await this.scanWlmouse(hid)
      await this.scanRazer(hid)
      // Recognised peripherals that no driver claimed: the vendors above, plus any mouse in the built-in catalog.
      this.unsupported.clear()
      const seen = new Set<string>()
      for (const d of hid) {
        const key = `${d.vendorId}:${d.productId}`
        if (seen.has(key) || this.heldVendor(d)) continue
        seen.add(key)
        const model = lookup(d.vendorId, d.productId)
        const k = KNOWN.find((x) => x.vid === d.vendorId && (x.pid === undefined || x.pid === d.productId))
        if (!model && !k) continue
        // Logitech mice are found through their receiver or cable by the HID++ driver instead.
        if (d.vendorId === 0x046d) continue
        const vendor = model?.vendor ?? k!.vendor
        const id = `${slug(vendor)}-${d.productId.toString(16).padStart(4, '0')}`
        if (this.live.has(id) || [...this.unsupported.values()].some((u) => u.name === (model?.name ?? k?.name))) continue
        const summary: DeviceSummary = {
          id, kind: (model?.kind === 'keyboard' ? 'keyboard' : (k?.kind ?? 'mouse')) as DeviceKind, vendor,
          name: model?.name ?? k!.name ?? cleanName(d.product ?? 'Device', vendor),
          connection: 'USB', status: 'unsupported', battery: null, capabilities: [], verified: false, demo: false, lastSeen: Date.now(),
          note: this.refused.get(id) ?? (model?.maxDpi ? `Up to ${model.maxDpi.toLocaleString('en-US')} DPI · support coming soon` : undefined),
          model: model && { protocol: model.protocol, maxDpi: model.maxDpi, popular: model.popular }
        }
        this.unsupported.set(id, summary)
        this.remember(summary)
      }
      await this.scanLogitech(hid)
      this.missingPermission = [...missing]
      this.searching = false
      this.changed()
    } finally {
      this.scanning = false
    }
  }

  private async scanKeyboard(list: HID.Device[]) {
    const ep = wootingEndpoint(list)
    if (!ep || !canOpen(ep.path) || this.heldPath(ep.path)) return
    const id = `wooting-${ep.productId.toString(16).padStart(4, '0')}`
    if (this.live.has(id)) return
    const t = await WootingTransport.open(ep.path)
    try {
      const s = new WootingSession(t, ep.product, ep.serial)
      await s.load()
      s.rememberFactoryLayer()
      const summary = this.keyboardSummary(id, s)
      this.live.set(id, { kind: 'wooting', summary, path: ep.path, session: s })
      this.remember(summary)
    } catch (e) {
      t.close()
      if (!offline(e)) console.error('keyboard failed to load', e)
    }
  }

  private async scanEndgame(list: HID.Device[]) {
    const ep = endgameEndpoint(list)
    if (!ep || !canOpen(ep.path) || this.heldPath(ep.path)) return
    const id = `endgame-gear-${ep.productId.toString(16).padStart(4, '0')}`
    if (this.live.has(id)) return
    const t = await EndgameTransport.open(ep.path)
    try {
      const s = new EndgameSession(t, EG_MODELS[ep.productId], ep.productId, ep.serial)
      await s.load()
      const summary = this.endgameSummary(id, s)
      this.live.set(id, { kind: 'endgame', summary, path: ep.path, session: s })
      void this.watchButtons(id, { vid: EG_VID, pid: ep.productId, report: 0x01 })
      this.remember(summary)
    } catch (e) {
      t.close()
      if (!offline(e)) console.error('Endgame Gear mouse failed to load', e)
    }
  }

  private async scanWlmouse(list: HID.Device[]) {
    const ep = wlmouseEndpoint(list)
    if (!ep || !canOpen(ep.path) || this.heldPath(ep.path)) return
    const id = `wlmouse-${ep.productId.toString(16).padStart(4, '0')}`
    if (this.live.has(id)) return
    const t = await WlTransport.open(ep.path)
    try {
      const s = new WlSession(t, WL_MODELS[ep.productId], ep.productId, ep.serial)
      await s.load()
      const summary = this.wlSummary(id, s)
      this.live.set(id, { kind: 'wlmouse', summary, path: ep.path, session: s })
      this.remember(summary)
    } catch (e) {
      t.close()
      if (!offline(e)) console.error('WLmouse failed to load', e)
    }
  }

  private async scanRazer(list: HID.Device[]) {
    const ep = razerEndpoint(list)
    if (!ep || !canOpen(ep.path) || this.heldPath(ep.path)) return
    const id = `razer-${ep.model.pid.toString(16).padStart(4, '0')}`
    if (this.live.has(id) || this.refused.has(id)) return
    const link = await HidLink.open(ep.path, ep.model.waitMs)
    const s = new RazerSession(new RazerTransport(link, ep.model.dpi![2]), ep.model, ep.serial)
    try {
      await s.load()
      const summary = this.razerSummary(id, s)
      this.live.set(id, { kind: 'razer', summary, path: ep.path, session: s })
      this.remember(summary)
    } catch (e) {
      link.close()
      // A wireless mouse that is off answers "timeout": try again on a later scan. Anything else: leave it alone.
      if (!offline(e)) this.refused.set(id, `Hubless couldn't read this mouse safely, so it changed nothing (${(e as Error).message})`)
    }
  }

  private async scanHeadset(list: HID.Device[]) {
    const path = scapeEndpoint(list)
    if (!path || !canOpen(path) || this.heldPath(path)) return
    const id = 'fractal-design-0001'
    if (this.live.has(id)) return
    const t = await ScapeTransport.open(path)
    try {
      const s = new ScapeSession(t)
      await s.load()
      const summary = this.headsetSummary(id, s)
      this.live.set(id, { kind: 'scape', summary, path, session: s })
      this.remember(summary)
    } catch (e) {
      t.close()
      if (!offline(e)) console.error('headset failed to load', e)
    }
  }

  private async scanLogitech(list: HID.Device[]) {
    const asleep = new Map<string, DeviceSummary>()
    for (const ep of endpoints(list)) {
      if (!canOpen(ep.path) || this.heldPath(ep.path)) continue
      let t = this.transports.get(ep.path)
      if (!t) {
        t = await HidrawTransport.open(ep.path)
        this.transports.set(ep.path, t)
      }
      const slots = ep.receiver ? await t.pairedDevices() : [{ slot: 0xff, wpid: 0, name: ep.name, serial: '' }]
      for (const { slot, name, serial } of slots) {
        const pre = serial ? `logitech-${serial}` : null
        if (pre && this.live.get(pre)?.summary.status === 'ready') continue
        if (!(await t.ping(slot))) {
          if (pre && this.live.has(pre)) this.markAsleep(pre, new Offline('asleep'))
          else if (pre)
            asleep.set(pre, {
              ...(this.known.get(pre) ?? {
                id: pre, kind: 'mouse', vendor: 'Logitech', name: name || 'Logitech mouse', connection: 'LIGHTSPEED wireless',
                capabilities: [], verified: false, demo: false
              }),
              status: 'asleep', battery: null, lastSeen: Date.now()
            } as DeviceSummary)
          continue
        }
        try {
          const dev = await new LogitechDevice(t, slot, name).connect()
          if (!dev.onboard && !dev.isSuperstrike) continue
          const s = new LogitechSession(dev)
          await s.load()
          const id = `logitech-${dev.serial || serial || ep.path}`
          const cat = lookup(0x046d, ep.receiver ? wpidOf(slots, slot) : ep.pid)
          if (cat) this.photoKeys.set(id, modelKey(cat.vendor, cat.name))
          if (ep.receiver) this.wpids.set(id, wpidOf(slots, slot))
          const summary = this.mouseSummary(id, s)
          this.live.set(id, { kind: 'logitech', summary, session: s, path: ep.path })
          void this.watchButtons(id, { vid: 0x046d, pid: ep.receiver ? wpidOf(slots, slot) : 0, report: 0x02 })
          this.remember(summary)
        } catch (e) {
          if (!offline(e)) console.error('connect failed', e)
        }
      }
    }
    for (const id of this.live.keys()) asleep.delete(id)
    this.asleepIds = asleep
  }

  private buttonStreams = new Map<string, HID.HIDAsync>()
  private hid: HID.Device[] = []

  /** Follow the mouse's own input reports so the UI can light up buttons as they're physically pressed. */
  private async watchButtons(id: string, src: { vid: number; pid: number; report: number }) {
    if (this.buttonStreams.has(id)) return
    const d = this.hid.find((x) => x.vendorId === src.vid && (src.pid ? x.productId === src.pid : true) && x.usagePage === 1 && x.usage === 2 && x.path)
    if (!d || !canOpen(d.path!)) return
    try {
      const dev = await HID.HIDAsync.open(d.path!)
      this.buttonStreams.set(id, dev)
      let last = -1
      dev.on('data', (r: Buffer) => {
        if (r[0] !== src.report) return // mouse report: [id, buttons lo, buttons hi, …]
        const mask = src.report === 0x02 ? r[1] | (r[2] << 8) : r[1]
        if (mask !== last) {
          last = mask
          this.emit('buttons', id, mask)
        }
      })
      dev.on('error', () => this.buttonStreams.delete(id))
    } catch {
      /* input node busy or missing; presses just won't light up */
    }
  }

  private async scanDemo() {
    if (!this.live.size) {
      this.sim = new SimTransport()
      const s = new LogitechSession(await new LogitechDevice(this.sim, 1).connect())
      await s.load()
      const cat = lookup(0x046d, 0x40bd) // the simulated mouse's wireless id, as on a real receiver
      if (cat) this.photoKeys.set('demo', modelKey(cat.vendor, cat.name))
      this.live.set('demo', { kind: 'logitech', summary: this.mouseSummary('demo', s), session: s, path: 'demo' })
      const fake = (id: string, kind: DeviceKind, vendor: string, name: string): DeviceSummary => ({
        id, kind, vendor, name, status: 'inactive', connection: 'USB', battery: null, capabilities: [], verified: false, demo: true, lastSeen: 0
      })
      // A simulated Razer Viper V3 Pro (wireless), driven through the real Razer driver.
      const viper = [...RAZER_MODELS.values()].find((m) => m.id === 'VIPER_V3_PRO_WIRELESS')!
      const r = new RazerSession(new RazerTransport(new SimRazer(viper), viper.dpi![2]), viper, '')
      await r.load()
      this.live.set('razer-demo', { kind: 'razer', summary: { ...this.razerSummary('razer-demo', r), demo: true }, session: r, path: 'demo-razer' })
      // Two mice with RGB lighting: a G502 HERO (cable) and a Basilisk V3 Pro (wireless).
      const g = new LogitechSession(await new LogitechDevice(new SimTransport('g502'), 0xff).connect())
      await g.load()
      this.photoKeys.set('demo-g502', modelKey('Logitech', 'G502 Hero'))
      this.live.set('demo-g502', { kind: 'logitech', summary: this.mouseSummary('demo-g502', g), session: g, path: 'demo-g502' })
      const basilisk = RAZER_MODELS.get(0x00ab)!
      const b = new RazerSession(new RazerTransport(new SimRazer(basilisk), basilisk.dpi![2]), basilisk, 'demo-basilisk')
      await b.load()
      this.live.set('razer-demo-2', { kind: 'razer', summary: { ...this.razerSummary('razer-demo-2', b), demo: true }, session: b, path: 'demo-razer-2' })
      this.known.set('demo-old', fake('demo-old', 'mouse', 'Endgame Gear', 'OP1 8k'))
    }
    this.searching = false
    this.changed()
  }

  // ---------------------------------------------------------------- firmware updates
  private usbKey = (d: { vendorId: number; productId: number }) =>
    `${d.vendorId.toString(16).padStart(4, '0')}:${d.productId.toString(16).padStart(4, '0')}`

  private heldUsb(d: { vendorId: number; productId: number }) {
    const k = this.usbKey(d)
    return [...this.held.values()].some((h) => h.usb.has(k))
  }

  /** A held keyboard restarts under another USB id to take new firmware: keep the maker's other ids quiet too. */
  private heldVendor(d: { vendorId: number }) {
    const v = d.vendorId.toString(16).padStart(4, '0') + ':'
    return [...this.held.values()].some((h) => [...h.usb].some((u) => u.startsWith(v)))
  }

  private heldPath(path: string) {
    if (!this.held.size) return false
    const d = this.hid.find((x) => x.path === path)
    return !!d && this.heldUsb(d)
  }

  isHeld(id: string) {
    return this.held.has(id)
  }

  /** USB ids ("046d:c54d") of a connected device: its USB device (the receiver, for a wireless Logitech mouse) and,
   *  behind a receiver, the mouse's own wireless id. */
  usbIds(id: string): string[] {
    const h = this.held.get(id)
    if (h) return [...h.usb]
    const e = this.live.get(id)
    if (!e) return []
    const hid = this.hid.length ? this.hid : HID.devices()
    const d = hid.find((x) => x.path === e.path)
    const out = d ? [this.usbKey(d)] : []
    const w = this.wpids.get(id)
    if (w) out.push(this.usbKey({ vendorId: 0x046d, productId: w }))
    return out
  }

  /** The firmware version the device reported. */
  firmwareVersion(id: string): string {
    const e = this.live.get(id)
    if (!e) return ''
    switch (e.kind) {
      case 'logitech':
        return e.session.dev.firmware
      case 'wooting':
        return e.session.state?.firmware ?? ''
      case 'scape':
        return [e.session.state.dongleFirmware && `dongle ${e.session.state.dongleFirmware}`, e.session.state.headsetFirmware && `headset ${e.session.state.headsetFirmware}`].filter(Boolean).join(', ')
      default:
        return e.session.fw
    }
  }

  /**
   * Let go of a device so another program (fwupd, Wootility) can talk to it: close Hubless's connection and leave
   * its USB ids alone until release(). A receiver is shared, so every mouse on it goes quiet too.
   */
  hold(id: string, note: string) {
    const e = this.live.get(id)
    if (!e) throw new Error('That device is not connected right now.')
    const usb = new Set(this.usbIds(id))
    const gone = e.kind === 'logitech' ? [...this.live].filter(([, x]) => x.path === e.path).map(([k]) => k) : [id]
    this.held.set(id, { usb, summary: { ...e.summary, status: 'asleep', battery: null, note }, parked: this.demo ? gone.map((k) => this.live.get(k)!) : [] })
    for (const k of gone) {
      this.buttonStreams.get(k)?.close().catch(() => {})
      this.buttonStreams.delete(k)
      this.live.delete(k)
    }
    if (this.demo) return this.changed() // simulated devices just wait to be put back
    if (e.kind === 'logitech') {
      this.transports.get(e.path)?.close()
      this.transports.delete(e.path)
    } else e.session.t.close()
    this.changed()
  }

  /** Take a held device back: it reconnects on the next scan (with its new firmware). */
  release(id: string) {
    const h = this.held.get(id)
    if (!h) return
    this.held.delete(id)
    for (const e of h.parked) this.live.set(e.summary.id, e)
    this.changed()
    void this.scan()
  }

  // ---------------------------------------------------------------- upkeep
  private async poll() {
    this.tick++
    // One USB enumeration per tick (13 ms, blocking) shared by the unplug check and the scan.
    const list = this.demo ? [] : HID.devices()
    const present = new Set(list.map((d) => d.path))
    for (const [id, e] of this.live) {
      if (!this.demo && !present.has(e.path)) {
        // Receiver, cable or dongle is gone: it moves to "Not connected", last used now.
        this.live.delete(id)
        this.touch(id)
        this.buttonStreams.get(id)?.close().catch(() => {})
        this.buttonStreams.delete(id)
        if (e.kind === 'logitech') {
          this.transports.get(e.path)?.close()
          this.transports.delete(e.path)
        } else e.session.t.close()
        this.changed()
        continue
      }
      if (e.summary.status === 'asleep' || this.tick % 4 === 0) await this.refresh(id, e)
    }
    if (this.tick % 3 === 0 || !this.live.size) await this.scan(list)
  }

  private async refresh(id: string, e: Live) {
    try {
      if (e.kind === 'logitech') {
        await e.session.refreshStatus()
        e.summary = this.mouseSummary(id, e.session)
      } else if (e.kind === 'scape') {
        const was = e.session.state.connected
        await e.session.refresh()
        if (!was && e.session.state.connected) await e.session.load() // headset switched on: read firmware and EQ
        e.summary = this.headsetSummary(id, e.session)
      } else if (e.kind === 'endgame') {
        await e.session.ping()
        e.summary = this.endgameSummary(id, e.session)
      } else if (e.kind === 'wlmouse') {
        await e.session.ping()
        e.summary = this.wlSummary(id, e.session)
      } else if (e.kind === 'razer') {
        await e.session.ping()
        e.summary = this.razerSummary(id, e.session)
      } else {
        await e.session.ping()
      }
      this.changed()
    } catch (err) {
      this.markAsleep(id, err)
    }
  }

  markAsleep(id: string, err: unknown) {
    const e = this.live.get(id)
    if (!e || !offline(err)) return
    if (e.summary.status !== 'asleep') {
      e.summary = { ...e.summary, status: 'asleep' }
      this.changed()
    }
  }

  private get<K extends Live['kind']>(id: string, kind: K): Extract<Live, { kind: K }> {
    const e = this.live.get(id)
    if (!e || e.kind !== kind) throw new Error('That device is not connected right now.')
    return e as Extract<Live, { kind: K }>
  }

  /** Logitech session (kept for the existing mouse API). */
  session(id: string): LogitechSession {
    return this.get(id, 'logitech').session
  }

  private async guard<T>(id: string, job: () => Promise<T>, asleepMessage: string): Promise<T> {
    try {
      const r = await job()
      const e = this.live.get(id)
      if (e && e.kind !== 'scape' && e.summary.status !== 'ready') {
        e.summary = { ...e.summary, status: 'ready' }
        this.changed()
      }
      return r
    } catch (err) {
      this.markAsleep(id, err)
      if (offline(err)) throw new Error(asleepMessage)
      throw err
    }
  }

  run<T>(id: string, job: (s: LogitechSession) => Promise<T>): Promise<T> {
    const s = this.session(id)
    return this.guard(id, () => job(s), 'The mouse is asleep. Move it or click a button to wake it up.')
  }

  /** Any editable mouse (Logitech or Endgame Gear). */
  runMouse<T>(id: string, job: (s: MouseSession) => Promise<T>): Promise<T> {
    const e = this.live.get(id)
    if (!e || !isMouse(e)) throw new Error('That mouse is not connected right now.')
    return this.guard(id, () => job(e.session), 'The mouse is asleep. Move it or click a button to wake it up.')
  }

  mouseSession(id: string): MouseSession {
    const e = this.live.get(id)
    if (!e || !isMouse(e)) throw new Error('That mouse is not connected right now.')
    return e.session
  }

  runKeyboard<T>(id: string, job: (s: WootingSession) => Promise<T>): Promise<T> {
    const s = this.get(id, 'wooting').session
    return this.guard(id, () => job(s), 'The keyboard is not answering. Try unplugging it and plugging it back in.')
  }

  async runHeadset<T>(id: string, job: (s: ScapeSession) => Promise<T>): Promise<T> {
    const e = this.get(id, 'scape')
    const r = await this.guard(id, () => job(e.session), 'The headset is switched off.')
    e.summary = this.headsetSummary(id, e.session)
    this.changed()
    return r
  }
}

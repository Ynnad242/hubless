// A simulated Razer keyboard for demo mode and tests: answers lighting, brightness and game-mode commands like the
// real one, and ignores requests sent with the wrong transaction id or command family.
import type { RazerLink } from './razer'
import type { RazerKeyboardModel } from './keyboard'

export class SimRazerKeyboard implements RazerLink {
  effect = { id: 4, rgb: [0, 255, 0] } // spectrum
  brightness = 255
  game = 0
  sent: string[] = []

  constructor(public model: RazerKeyboardModel) {}

  async exchange(req: Uint8Array): Promise<Uint8Array> {
    const r = Uint8Array.from(req)
    const [tx, cls, id] = [req[1], req[6], req[7]]
    const a = req.subarray(8)
    const m = this.model
    const ok = () => ((r[0] = 2), r)
    const no = () => ((r[0] = 5), r)
    this.sent.push(`${tx.toString(16)}:${cls.toString(16)}:${id.toString(16)}`)
    if (cls === 0x0f && id === 0x02 && m.variant === 'extended' && tx === m.tx && a[1] === m.led) {
      this.effect = { id: [0, 6, 3, 4][a[2]], rgb: [a[6], a[7], a[8]] }
      return ok()
    }
    if (cls === 0x03 && id === 0x0a && m.variant === 'standard' && tx === m.tx) {
      this.effect = a[0] === 3 ? { id: 3, rgb: [a[2], a[3], a[4]] } : { id: a[0], rgb: [a[1], a[2], a[3]] }
      return ok()
    }
    const b = m.brightness
    if (b && tx === b.tx && a[1] === b.args[1] && ((b.variant === 'extended' && cls === 0x0f) || (b.variant === 'standard' && cls === 0x03))) {
      if (id === 0x04 || id === 0x03) {
        this.brightness = a[2]
        return ok()
      }
      if (id === 0x84 || id === 0x83) return ((r[10] = this.brightness), ok())
    }
    const g = m.game
    if (g && cls === 0x03 && tx === g.tx && a[1] === 0x08) {
      if (id === 0x00) {
        this.game = a[2] & 1
        return ok()
      }
      if (id === 0x80) return ((r[10] = this.game), ok())
    }
    return no()
  }

  close() {}
}

// Firmware updates: matching fwupd's devices to Hubless's, and letting go of a device while it updates.
import { describe, expect, it } from 'vitest'
import { components, plainNotes, usbIdsOf } from '../src/main/firmware'
import { DeviceManager } from '../src/main/manager'

const bolt = {
  DeviceId: 'a'.repeat(40), Name: 'Bolt Receiver', Version: 'MPR05.00_B0010', Flags: ['updatable', 'unsigned-payload'],
  InstanceIds: ['USB\\VID_046D&PID_C548', 'USB\\VID_046D&PID_C548&REV_0001']
}
const mouse = { DeviceId: 'b'.repeat(40), Name: 'MX Master 3', Version: 'RBM14.00_0004', Flags: ['updatable'], InstanceIds: ['HIDRAW\\VEN_046D&DEV_4082'] }
const ssd = { DeviceId: 'c'.repeat(40), Name: 'WD BLACK SN850X', Flags: ['internal', 'updatable'], InstanceIds: ['NVME\\VEN_15B7&DEV_5030'] }

describe('fwupd matching', () => {
  it('reads USB ids from instance ids, including mice behind a receiver', () => {
    expect(usbIdsOf(bolt)).toEqual(['046d:c548'])
    expect(usbIdsOf(mouse)).toEqual(['046d:4082'])
    expect(usbIdsOf(ssd)).toEqual([])
  })

  it('shows only the parts of this device, with their update', () => {
    const updates = [{ ...bolt, Releases: [{ Version: 'MPR05.02_B0012', Summary: 'Receiver firmware', Description: '<p>Fixes:</p><ul><li>Pairing &amp; range</li></ul>', Size: 90000 }] }]
    const got = components([bolt, mouse, ssd], updates, ['046d:c548', '046d:4082'])
    expect(got.map((c) => c.name)).toEqual(['Bolt Receiver', 'MX Master 3'])
    expect(got[0].update).toEqual({ version: 'MPR05.02_B0012', summary: 'Receiver firmware', notes: 'Fixes:\n• Pairing & range', sizeBytes: 90000 })
    expect(got[1].update).toBeUndefined()
    expect(components([bolt, mouse, ssd], [], ['36a7:a875'])).toEqual([]) // a device fwupd doesn't know: nothing
  })

  it('turns release notes into plain text', () => {
    expect(plainNotes('<p>A</p><p>B &lt;3</p>')).toBe('A\nB <3')
  })
})

describe('letting go of a device', () => {
  it('holds a device with a note, keeps its card, and puts it back', async () => {
    const m = new DeviceManager(true)
    await m.scan([])
    const before = m.snapshot().devices.find((d) => d.id === 'demo-g502')!
    expect(before.status).toBe('ready')
    m.hold('demo-g502', 'Updating firmware… keep it plugged in')
    const held = m.snapshot().devices.find((d) => d.id === 'demo-g502')!
    expect(held).toMatchObject({ status: 'asleep', note: 'Updating firmware… keep it plugged in' })
    expect(m.isHeld('demo-g502')).toBe(true)
    expect(() => m.runMouse('demo-g502', async () => 1)).toThrow('not connected') // nothing talks to it meanwhile
    m.release('demo-g502')
    expect(m.isHeld('demo-g502')).toBe(false)
    expect(m.snapshot().devices.find((d) => d.id === 'demo-g502')!.status).toBe('ready')
    m.stop()
  })
})

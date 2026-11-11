import { describe, expect, it } from 'vitest'
import type { DeviceSummary } from '@shared/types'
import { DeviceManager } from '../src/main/manager'

const dev = (id: string, kind: DeviceSummary['kind'], name: string, status: DeviceSummary['status']): DeviceSummary => ({
  id, kind, vendor: 'Test', name, status, connection: 'USB', battery: null, capabilities: ['device'], verified: true, demo: true, lastSeen: 1
})

describe('device order', () => {
  it('does not change when a device falls asleep or wakes up', () => {
    const m = new DeviceManager(true)
    const live = (m as unknown as { live: Map<string, { kind: string; summary: DeviceSummary; path: string }> }).live
    const known = (m as unknown as { known: Map<string, DeviceSummary> }).known
    live.set('a', { kind: 'logitech', summary: dev('a', 'mouse', 'Zeta mouse', 'ready'), path: 'a' })
    live.set('b', { kind: 'endgame', summary: dev('b', 'mouse', 'Alpha mouse', 'ready'), path: 'b' })
    live.set('c', { kind: 'scape', summary: dev('c', 'headset', 'Headset', 'ready'), path: 'c' })
    known.set('d', dev('d', 'mouse', 'Old mouse', 'inactive'))
    const order = () => m.snapshot().devices.map((d) => d.id)
    const awake = order()
    expect(awake).toEqual(['b', 'a', 'c', 'd'])
    // The mouse and the headset doze off while the user is away…
    live.get('b')!.summary.status = 'asleep'
    live.get('c')!.summary.status = 'asleep'
    expect(order()).toEqual(awake)
    // …and wake up again.
    live.get('b')!.summary.status = 'ready'
    expect(order()).toEqual(awake)
  })
})

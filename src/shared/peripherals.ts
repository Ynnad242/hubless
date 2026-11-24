// Logitech G headsets and keyboards by the name they report over HID++ ("G733 Gaming Headset",
// "G915 TKL LIGHTSPEED Wireless RGB Mechanical Gaming Keyboard"), with the product name Hubless shows. The product
// name also picks the shipped photo (data/devices/logitech-<name>.png). Others keep their own name.
export const LOGITECH_PERIPHERALS: { name: string; kind: 'headset' | 'keyboard'; match: RegExp }[] = [
  { name: 'G915 X TKL', kind: 'keyboard', match: /G915\s*X\s*TKL/i },
  { name: 'G915 X', kind: 'keyboard', match: /G915\s*X\b/i },
  { name: 'G915 TKL', kind: 'keyboard', match: /G915\s*TKL/i },
  { name: 'G915', kind: 'keyboard', match: /G915/i },
  { name: 'G815', kind: 'keyboard', match: /G815/i },
  { name: 'G515 Rapid TKL', kind: 'keyboard', match: /G515\s*Rapid/i },
  { name: 'G515 TKL', kind: 'keyboard', match: /G515/i },
  { name: 'G513', kind: 'keyboard', match: /G513/i },
  { name: 'G512', kind: 'keyboard', match: /G512/i },
  { name: 'PRO X TKL Rapid', kind: 'keyboard', match: /PRO\s*X\s*TKL\s*Rapid/i },
  { name: 'G PRO X TKL', kind: 'keyboard', match: /PRO\s*X\s*TKL/i },
  { name: 'G PRO Keyboard', kind: 'keyboard', match: /PRO.*Keyboard/i },
  { name: 'G213', kind: 'keyboard', match: /G213/i },
  { name: 'G733', kind: 'headset', match: /G733/i },
  { name: 'G735', kind: 'headset', match: /G735/i },
  { name: 'G535', kind: 'headset', match: /G535/i },
  { name: 'G435', kind: 'headset', match: /G435/i },
  { name: 'G935', kind: 'headset', match: /G935/i },
  { name: 'G933', kind: 'headset', match: /G933/i },
  { name: 'G633', kind: 'headset', match: /G633/i },
  { name: 'G533', kind: 'headset', match: /G533/i },
  { name: 'PRO X Wireless', kind: 'headset', match: /PRO\s*X\s*Wireless.*Headset/i }
]

export const logitechPeripheralName = (reported: string) => LOGITECH_PERIPHERALS.find((p) => p.match.test(reported))?.name

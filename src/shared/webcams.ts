// Popular webcams by the name the camera reports to Linux ("HD Pro Webcam C920"), with the product name Hubless shows.
// The product name also picks the shipped photo (data/devices/<vendor>-<name>.png). Any other webcam keeps its own name.
export const WEBCAMS: { vendor: string; name: string; match: RegExp }[] = [
  { vendor: 'Logitech', name: 'C922 Pro Stream', match: /C922/i },
  { vendor: 'Logitech', name: 'C920S HD Pro', match: /C920S/i },
  { vendor: 'Logitech', name: 'C920 HD Pro', match: /C920/i },
  { vendor: 'Logitech', name: 'MX Brio', match: /MX\s*Brio/i },
  { vendor: 'Logitech', name: 'Brio 500', match: /Brio\s*500/i },
  { vendor: 'Logitech', name: 'Brio 300', match: /Brio\s*300/i },
  { vendor: 'Logitech', name: 'Brio 100', match: /Brio\s*100/i },
  { vendor: 'Logitech', name: 'Brio', match: /BRIO/i },
  { vendor: 'Logitech', name: 'StreamCam', match: /StreamCam/i },
  { vendor: 'Logitech', name: 'C930e', match: /C930/i },
  { vendor: 'Logitech', name: 'C925e', match: /C925/i },
  { vendor: 'Logitech', name: 'C615', match: /C615/i },
  { vendor: 'Logitech', name: 'C310', match: /C310/i },
  { vendor: 'Logitech', name: 'C270', match: /C270/i },
  { vendor: 'Razer', name: 'Kiyo V2 Pro', match: /Kiyo\s*V2\s*Pro/i },
  { vendor: 'Razer', name: 'Kiyo V2 X', match: /Kiyo\s*V2\s*X/i },
  { vendor: 'Razer', name: 'Kiyo V2', match: /Kiyo\s*V2/i },
  { vendor: 'Razer', name: 'Kiyo Pro Ultra', match: /Kiyo\s*Pro\s*Ultra/i },
  { vendor: 'Razer', name: 'Kiyo Pro', match: /Kiyo\s*Pro/i },
  { vendor: 'Razer', name: 'Kiyo X', match: /Kiyo\s*X/i },
  { vendor: 'Razer', name: 'Kiyo', match: /Kiyo/i },
  { vendor: 'Elgato', name: 'Facecam Pro', match: /Facecam\s*Pro/i },
  { vendor: 'Elgato', name: 'Facecam MK.2', match: /Facecam\s*MK\.?\s*2/i },
  { vendor: 'Elgato', name: 'Facecam Neo', match: /Facecam\s*Neo/i },
  { vendor: 'Elgato', name: 'Facecam 4K', match: /Facecam\s*4K/i },
  { vendor: 'Elgato', name: 'Facecam', match: /Facecam/i }
]

/** The product name for a webcam's reported name, or undefined when it isn't one of the popular ones. */
export const camName = (reported: string) => WEBCAMS.find((w) => w.match.test(reported))?.name

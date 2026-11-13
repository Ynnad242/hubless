// Device identity helpers shared by both processes.

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** "Logitech" + "PRO X2 SUPERSTRIKE" → "logitech-pro-x2-superstrike": names the photo shipped for that model. */
export const modelKey = (vendor: string, name: string) => `${slug(vendor)}-${slug(name)}`

/** Which shipped photo a device uses: its catalog model's when known, else the one its name gives. */
export const photoKey = (d: { vendor: string; name: string; photo?: string }) =>
  typeof d.photo === 'string' && /^[a-z0-9-]{1,80}$/.test(d.photo) ? d.photo : modelKey(d.vendor, d.name)

/** Key under which deviceImages() returns a model's shipped photo. */
export const modelImageKey = (d: { vendor: string; name: string; photo?: string }) => `model:${photoKey(d)}`

/** The user's own photo for this exact device, else the photo shipped for its model. */
export function photoFor(images: Record<string, string>, d: { id: string; vendor: string; name: string; photo?: string }): string | undefined {
  return images[d.id] ?? images[modelImageKey(d)]
}

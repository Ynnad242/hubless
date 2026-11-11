// Device identity helpers shared by both processes.

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** "Logitech" + "PRO X2 SUPERSTRIKE" → "logitech-pro-x2-superstrike": names the photo shipped for that model. */
export const modelKey = (vendor: string, name: string) => `${slug(vendor)}-${slug(name)}`

/** Key under which deviceImages() returns a model's shipped photo. */
export const modelImageKey = (vendor: string, name: string) => `model:${modelKey(vendor, name)}`

/** The user's own photo for this exact device, else the photo shipped for its model. */
export function photoFor(images: Record<string, string>, d: { id: string; vendor: string; name: string }): string | undefined {
  return images[d.id] ?? images[modelImageKey(d.vendor, d.name)]
}

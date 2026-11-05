import { useEffect, useState } from 'react'

/** Buttons currently held on the physical mouse (profile slot indexes: 0 left, 1 right, 2 middle, 3 back, 4 forward). */
export function usePhysicalButtons(id: string): number[] {
  const [mask, setMask] = useState(0)
  useEffect(() => window.hubless.onButtons((dev, m) => dev === id && setMask(m)), [id])
  return [0, 1, 2, 3, 4].filter((i) => mask & (1 << i))
}

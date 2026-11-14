import { useEffect, useState } from 'react'

/** Live key travel (rows × cols, 0..255) while `active`; polls ~20×/s, only while the window is focused. */
export function useAnalog(id: string, active: boolean): number[][] | null {
  const [rows, setRows] = useState<number[][] | null>(null)
  useEffect(() => {
    if (!active) return
    let stop = false
    const loop = async () => {
      while (!stop) {
        if (document.hasFocus()) {
          try {
            setRows(await window.hubless.keyboardAnalog(id))
          } catch {
            /* keyboard busy or gone; try again */
          }
        }
        await new Promise((r) => setTimeout(r, 12)) // a read takes ~6 ms; ~55 Hz catches quick taps
      }
    }
    void loop()
    return () => {
      stop = true
    }
  }, [id, active])
  return rows
}

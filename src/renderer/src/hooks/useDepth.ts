import { useEffect, useState } from 'react'

/** Live HITS button depth [left, right] (0..10) while the component is mounted. */
export function useDepth(id: string): [number, number] {
  const [d, setD] = useState<[number, number]>([0, 0])
  useEffect(() => {
    const off = window.hubless.onDepth((dev, l, r) => dev === id && setD([l, r]))
    void window.hubless.watchDepth(id, true).catch(() => {})
    return () => {
      off()
      void window.hubless.watchDepth(id, false).catch(() => {})
    }
  }, [id])
  return d
}

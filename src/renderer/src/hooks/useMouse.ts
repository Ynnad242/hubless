import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Hits, MouseState, ProfileData } from '@shared/types'

const api = () => window.hubless
const SAVE_DELAY = 450

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Loads a mouse's state and keeps an editable draft of one profile.
 * Every edit is saved to the mouse shortly after it's made; HITS edits are also previewed live.
 */
export function useMouse(id: string | null) {
  const [state, setState] = useState<MouseState | null>(null)
  const [editSector, setEditSector] = useState(0)
  const [draft, setDraft] = useState<ProfileData | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const draftRef = useRef<ProfileData | null>(null)
  const dirty = useRef(false)
  const saving = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewQueue = useRef<Hits[] | null>(null)
  const previewing = useRef(false)

  const adopt = useCallback((s: MouseState, sector?: number) => {
    setState(s)
    const sec = sector ?? s.activeSector
    setEditSector(sec)
    if (!dirty.current) {
      const p = s.profiles.find((x) => x.sector === sec) ?? s.profiles[0]
      draftRef.current = p ? structuredClone(p) : null
      setDraft(draftRef.current)
    }
  }, [])

  const reload = useCallback(async () => {
    if (!id) return
    try {
      adopt(await api().mouseState(id), editSector || undefined)
    } catch (e) {
      toast.error(String((e as Error).message ?? e))
    }
  }, [id, adopt, editSector])

  useEffect(() => {
    dirty.current = false
    setState(null)
    setDraft(null)
    setEditSector(0)
    if (id) api().mouseState(id).then((s) => adopt(s)).catch((e) => toast.error(String(e.message ?? e)))
  }, [id, adopt])

  const saveNow = useCallback(async () => {
    timer.current = null
    if (!id || !draftRef.current) return
    if (saving.current) {
      timer.current = setTimeout(saveNow, 150)
      return
    }
    if (!dirty.current) return
    dirty.current = false
    saving.current = true
    setSaveStatus('saving')
    try {
      const s = await api().saveProfile(id, draftRef.current)
      setState(s)
      setSaveStatus(dirty.current ? 'saving' : 'saved')
    } catch (e) {
      dirty.current = true
      setSaveStatus('error')
      toast.error(String((e as Error).message ?? e))
    } finally {
      saving.current = false
    }
  }, [id])

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current)
      await saveNow()
    }
  }, [saveNow])

  /** Edit the draft. The change is saved to the mouse shortly after. */
  const update = useCallback(
    (fn: (d: ProfileData) => void, opts: { immediate?: boolean; previewHits?: boolean } = {}) => {
      if (!draftRef.current) return
      const next = structuredClone(draftRef.current)
      fn(next)
      draftRef.current = next
      setDraft(next)
      dirty.current = true
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(saveNow, opts.immediate ? 0 : SAVE_DELAY)
      if (opts.previewHits && next.hits && id && state && next.sector === state.activeSector) {
        previewQueue.current = next.hits
        if (!previewing.current) {
          previewing.current = true
          void (async () => {
            while (previewQueue.current) {
              const h = previewQueue.current
              previewQueue.current = null
              await api().previewHits(id, h).catch(() => {})
            }
            previewing.current = false
          })()
        }
      }
    },
    [id, saveNow, state]
  )

  const editProfile = useCallback(
    async (sector: number) => {
      await flush()
      if (!state) return
      dirty.current = false
      adopt(state, sector)
    },
    [flush, state, adopt]
  )

  /** Run a whole-device action (switch profile, restore…) and adopt the new state. */
  const act = useCallback(
    async (fn: () => Promise<MouseState | null>, message?: string, sector?: number) => {
      await flush()
      try {
        const s = await fn()
        if (s) {
          dirty.current = false
          adopt(s, sector ?? editSector)
          if (message) toast.success(message)
        }
      } catch (e) {
        toast.error(String((e as Error).message ?? e))
      }
    },
    [flush, adopt, editSector]
  )

  return { state, draft, editSector, saveStatus, update, editProfile, act, reload, flush }
}

export type MouseCtl = ReturnType<typeof useMouse>

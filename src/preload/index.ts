import { contextBridge, ipcRenderer } from 'electron'
import type { AppSnapshot, HublessApi } from '@shared/types'

const call =
  (method: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke('hubless:call', method, args)

const methods = [
  'snapshot', 'mouseState', 'saveProfile', 'previewHits', 'watchDepth', 'activateProfile', 'setProfileEnabled', 'replaceProfile',
  'backup', 'listBackups', 'restoreBackup', 'openBackupsFolder', 'exportProfile', 'importProfile', 'grantAccess', 'forgetDevice', 'appSettings', 'setAppSettings',
  'deviceImages', 'chooseDeviceImage', 'clearDeviceImage', 'appInfo', 'readDocument', 'deleteAllData',
  'keyboardState', 'keyboardAction', 'keyboardAnalog', 'headsetState', 'setHeadset'
]

const api = Object.fromEntries(methods.map((m) => [m, call(m)])) as unknown as HublessApi
api.onChange = (cb: (s: AppSnapshot) => void) => {
  const listener = (_e: unknown, s: AppSnapshot) => cb(s)
  ipcRenderer.on('hubless:changed', listener)
  return () => ipcRenderer.removeListener('hubless:changed', listener)
}

api.onButtons = (cb: (id: string, mask: number) => void) => {
  const listener = (_e: unknown, id: string, mask: number) => cb(id, mask)
  ipcRenderer.on('hubless:buttons', listener)
  return () => ipcRenderer.removeListener('hubless:buttons', listener)
}

api.onDepth = (cb: (id: string, l: number, r: number) => void) => {
  const listener = (_e: unknown, id: string, l: number, r: number) => cb(id, l, r)
  ipcRenderer.on('hubless:depth', listener)
  return () => ipcRenderer.removeListener('hubless:depth', listener)
}

contextBridge.exposeInMainWorld('hubless', api)

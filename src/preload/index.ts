import { contextBridge, ipcRenderer } from 'electron'
import {
  EVENT_CHANNELS,
  REQUEST_CHANNELS,
  type EventChannel,
  type EventMap,
  type RequestChannel,
  type RequestMap
} from '@shared/ipc'

const requestSet = new Set<string>(REQUEST_CHANNELS)
const eventSet = new Set<string>(EVENT_CHANNELS)

const api = {
  invoke<C extends RequestChannel>(
    channel: C,
    ...args: RequestMap[C][0]
  ): Promise<RequestMap[C][1]> {
    if (!requestSet.has(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },

  on<C extends EventChannel>(
    channel: C,
    listener: (payload: EventMap[C]) => void
  ): () => void {
    if (!eventSet.has(channel)) {
      throw new Error(`Blocked event channel: ${channel}`)
    }
    const wrapped = (_e: unknown, payload: EventMap[C]): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },

  /** Node platform string (e.g. 'darwin', 'win32', 'linux') for OS-aware UI. */
  platform: process.platform as string
}

contextBridge.exposeInMainWorld('api', api)

export type PreloadApi = typeof api

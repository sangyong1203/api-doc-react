import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge } from '../src/types/desktop.js'

const bridge: DesktopBridge = {
  versions: Object.freeze({ electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome }),
  onCloseRequested(listener) {
    const receive = (_event: Electron.IpcRendererEvent, requestId: unknown) => {
      if (typeof requestId === 'string') { listener(requestId) }
    }
    ipcRenderer.on('app:close-request', receive)
    return () => { ipcRenderer.removeListener('app:close-request', receive) }
  },
  respondToClose(requestId, state) {
    ipcRenderer.send('app:close-state', requestId, { dirty: state.dirty, running: state.running })
  },
}

contextBridge.exposeInMainWorld('apidocDesktop', bridge)

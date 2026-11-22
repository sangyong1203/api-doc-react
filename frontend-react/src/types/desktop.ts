import type { DesktopDataApi } from './desktopData.js'

export type AppCloseState = { dirty: boolean; running: boolean }

export type DesktopBridge = {
  workspace: Pick<DesktopDataApi['workspace'], 'open' | 'create' | 'snapshot' | 'release' | 'commit' | 'commitStatus'>
  versions: Readonly<{ electron: string; node: string; chrome: string }>
  onCloseRequested: (listener: (requestId: string) => void) => () => void
  respondToClose: (requestId: string, state: AppCloseState) => void
}

declare global {
  interface Window {
    apidocDesktop?: DesktopBridge
  }
}

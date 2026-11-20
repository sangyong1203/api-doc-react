export type AppCloseState = { dirty: boolean; running: boolean }

export type DesktopBridge = {
  versions: Readonly<{ electron: string; node: string; chrome: string }>
  onCloseRequested: (listener: (requestId: string) => void) => () => void
  respondToClose: (requestId: string, state: AppCloseState) => void
}

declare global {
  interface Window {
    apidocDesktop?: DesktopBridge
  }
}

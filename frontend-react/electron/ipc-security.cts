import type { AppCloseState } from '../src/types/desktop.js'

/** 개발은 검증된 Vite origin, 배포는 앱 프로토콜의 고정 host만 허용합니다. */
export function isTrustedAppUrl(value: string, devUrl: string | null): boolean {
  try {
    const url = new URL(value)
    if (url.username || url.password) { return false }
    if (devUrl) {
      const expected = new URL(devUrl)
      return expected.protocol === 'http:' && expected.hostname === '127.0.0.1'
        && !expected.username && !expected.password && expected.pathname === '/' && !expected.search && !expected.hash
        && url.origin === expected.origin
    }
    return url.protocol === 'apidoc:' && url.hostname === 'app' && !url.port
  } catch { return false }
}

// URL만 같은 iframe/다른 창이 권한을 얻지 않도록 객체 소유권과 주 프레임을 함께 확인합니다.
export function isTrustedIpcSender(
  event: { sender: unknown; senderFrame: { url: string } | null },
  owner: { mainFrame: { url: string }; isDestroyed: () => boolean } | null,
  devUrl: string | null,
): boolean {
  if (!owner || owner.isDestroyed()) { return false }
  try {
    return event.sender === owner && event.senderFrame === owner.mainFrame && isTrustedAppUrl(owner.mainFrame.url, devUrl)
  } catch {
    // 화면 재로드·종료 중 분리된 프레임은 호출자로 인정하지 않습니다.
    return false
  }
}

export function isAppCloseState(value: unknown): value is AppCloseState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { return false }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) { return false }
  const state = value as Record<string, unknown>
  return Object.keys(state).length === 2 && Object.hasOwn(state, 'dirty') && Object.hasOwn(state, 'running')
    && typeof state.dirty === 'boolean' && typeof state.running === 'boolean'
}

import { useEffect, useId, useLayoutEffect } from 'react'
import type { AppCloseState } from '@/types/desktop'

// 숨겨진 작업 공간과 포털의 편집 폼도 종료 확인에 포함합니다. 데이터 자체는 보관하지 않습니다.
const protections = new Map<string, AppCloseState>()

function getCloseState(): AppCloseState {
  const states = [...protections.values()]
  return { dirty: states.some((state) => state.dirty), running: states.some((state) => state.running) }
}

export function useAppCloseProtection(dirty: boolean, running = false) {
  const id = useId()
  useLayoutEffect(() => {
    protections.set(id, { dirty, running })
    return () => { protections.delete(id) }
  }, [id, dirty, running])
}

// 앱 루트에서 한 번 연결합니다. 종료 요청마다 최신 편집 상태를 조회합니다.
export function useAppCloseLifecycle() {
  useEffect(() => {
    const desktop = window.apidocDesktop
    if (desktop) {
      return desktop.onCloseRequested((requestId) => desktop.respondToClose(requestId, getCloseState()))
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const state = getCloseState()
      if (state.dirty || state.running) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])
}

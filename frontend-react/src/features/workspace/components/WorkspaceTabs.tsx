import { useEffect, useId, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, LoaderCircle, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { WorkspaceTab } from '../types'

type WorkspaceTabsProps = {
  tabs: WorkspaceTab[]
  onClose: (id: string) => void
}

export function WorkspaceTabs({ tabs, onClose }: WorkspaceTabsProps) {
  const navigationRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const viewportId = useId()
  const [scrollState, setScrollState] = useState({ overflowing: false, canScrollLeft: false, canScrollRight: false })

  useEffect(() => {
    const navigation = navigationRef.current
    const viewport = viewportRef.current
    const list = listRef.current
    if (!navigation || !viewport || !list) {
      return
    }

    function updateScrollState() {
      if (!navigation || !viewport || !list) {
        return
      }
      // 버튼이 차지하기 전의 전체 너비를 기준으로 표시 여부가 반복해서 바뀌지 않게 합니다.
      const next = {
        overflowing: list.scrollWidth > navigation.clientWidth + 1,
        canScrollLeft: viewport.scrollLeft > 1,
        canScrollRight: viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1,
      }
      setScrollState((current) => current.overflowing === next.overflowing
        && current.canScrollLeft === next.canScrollLeft
        && current.canScrollRight === next.canScrollRight ? current : next)
    }

    const observer = new ResizeObserver(updateScrollState)
    observer.observe(navigation)
    observer.observe(viewport)
    observer.observe(list)
    viewport.addEventListener('scroll', updateScrollState, { passive: true })
    return () => {
      observer.disconnect()
      viewport.removeEventListener('scroll', updateScrollState)
    }
  }, [tabs.length])

  // direction은 이전(-1) 또는 다음(1) 방향이며 보이는 폭의 약 3/4만큼 이동합니다.
  function scrollTabs(direction: -1 | 1) {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    viewport.scrollBy({
      left: direction * Math.max(120, viewport.clientWidth * 0.75),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }

  if (tabs.length === 0) {
    return <span className="tabs-empty">열린 API가 없습니다</span>
  }

  return (
    <div className="workspace-tab-navigation" ref={navigationRef}>
      {scrollState.overflowing && (
        <Button
          className="workspace-tab-scroll-button"
          variant="ghost"
          size="icon-sm"
          aria-label="작업 탭 왼쪽으로 이동"
          aria-controls={viewportId}
          disabled={!scrollState.canScrollLeft}
          onClick={() => scrollTabs(-1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
      )}
      <div className="workspace-tabs-scroll" id={viewportId} ref={viewportRef}>
        <TabsList className="workspace-tabs" variant="line" aria-label="열린 API" ref={listRef}>
          {tabs.map(({ request, saved, execution }) => {
            const dirty = JSON.stringify(request) !== JSON.stringify(saved)
            return (
              <div className="workspace-tab" key={request.id}>
                <TabsTrigger className="workspace-tab-select" value={request.id}>
                  {request.name}
                  {dirty && <Badge variant="warning">미저장</Badge>}
                  {execution.status === 'running' && (
                    <LoaderCircle className="motion-safe:animate-spin" aria-label="실행 중" />
                  )}
                </TabsTrigger>
                <Button
                  className="tab-close"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${request.name} 탭 닫기`}
                  onClick={() => onClose(request.id)}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            )
          })}
        </TabsList>
      </div>
      {scrollState.overflowing && (
        <Button
          className="workspace-tab-scroll-button"
          variant="ghost"
          size="icon-sm"
          aria-label="작업 탭 오른쪽으로 이동"
          aria-controls={viewportId}
          disabled={!scrollState.canScrollRight}
          onClick={() => scrollTabs(1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}

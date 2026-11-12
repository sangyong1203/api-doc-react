import { useEffect, useRef, useState } from 'react'
import { Braces, FolderOpen, Unplug } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { CollectionSidebar } from '@/features/collections/components/CollectionSidebar'
import { RequestEditor } from '@/features/api-editor/components/RequestEditor'
import { ResponseViewer } from '@/features/request-runner/components/ResponseViewer'
import { WorkspaceTabs } from '@/features/workspace/components/WorkspaceTabs'
import { createSampleResponse, SAMPLE_REQUESTS } from '@/features/workspace/fixtures/sampleWorkspace'
import type { SampleOutcome, SampleRequest, WorkspaceTab } from '@/features/workspace/types'
import '@/styles/workspace.css'

function createTab(request: SampleRequest): WorkspaceTab {
  return { request, saved: request, execution: { status: 'idle' } }
}

export function WorkspacePage() {
  const [requests, setRequests] = useState(SAMPLE_REQUESTS)
  const [tabs, setTabs] = useState<WorkspaceTab[]>([createTab(SAMPLE_REQUESTS[0])])
  const [activeId, setActiveId] = useState<string | null>(SAMPLE_REQUESTS[0].id)
  const [environment, setEnvironment] = useState('local')
  const [notice, setNotice] = useState('')
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const activeTab = tabs.find((tab) => tab.request.id === activeId)

  useEffect(() => {
    const pendingTimers = timers.current
    return () => {
      pendingTimers.forEach((timer) => clearTimeout(timer))
    }
  }, [])

  function updateTab(id: string, update: (tab: WorkspaceTab) => WorkspaceTab) {
    setTabs((current) => current.map((tab) => tab.request.id === id ? update(tab) : tab))
  }

  function openRequest(request: SampleRequest) {
    if (!tabs.some((tab) => tab.request.id === request.id)) {
      setTabs((current) => [...current, createTab(request)])
    }
    setActiveId(request.id)
  }

  function closeTab(id: string) {
    const target = tabs.find((tab) => tab.request.id === id)
    if (!target) {
      return
    }
    const dirty = JSON.stringify(target.request) !== JSON.stringify(target.saved)
    if ((dirty || target.execution.status === 'running') && !window.confirm(`${target.request.name}: ${dirty ? '미저장 변경이 사라집니다. ' : ''}${target.execution.status === 'running' ? '샘플 실행을 중단합니다. ' : ''}탭을 닫으시겠습니까?`)) {
      return
    }
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    const remaining = tabs.filter((tab) => tab.request.id !== id)
    const index = tabs.findIndex((tab) => tab.request.id === id)
    setTabs(remaining)
    if (activeId === id) {
      setActiveId(remaining[Math.min(index, remaining.length - 1)]?.request.id ?? null)
    }
  }

  // 요청 ID별 타이머를 관리해 탭 전환·취소·닫기 후 다른 탭에 결과가 섞이지 않게 합니다.
  function runSample(outcome: SampleOutcome) {
    if (!activeTab || timers.current.has(activeTab.request.id)) {
      return
    }
    const { request } = activeTab
    updateTab(request.id, (tab) => ({ ...tab, execution: { status: 'running' } }))
    const timer = setTimeout(() => {
      timers.current.delete(request.id)
      updateTab(request.id, (tab) => ({ ...tab, execution: outcome === 'network-error'
        ? { status: 'error', message: '연결 실패 상황을 재현한 샘플입니다. 실제 네트워크 요청은 전송하지 않았습니다.' }
        : { status: 'complete', response: createSampleResponse(request.id, request.method, outcome) } }))
    }, 1200)
    timers.current.set(request.id, timer)
  }

  function cancelSample() {
    if (!activeId) {
      return
    }
    clearTimeout(timers.current.get(activeId))
    timers.current.delete(activeId)
    updateTab(activeId, (tab) => ({ ...tab, execution: { status: 'cancelled' } }))
  }

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <div className="workspace-brand"><Braces aria-hidden="true" />API Doc</div>
        <Separator orientation="vertical" className="header-divider" />
        <div className="workspace-name"><FolderOpen aria-hidden="true" /><span>Robot workspace</span></div>
        <div className="environment-picker">
          <label htmlFor="workspace-environment">환경</label>
          <Select value={environment} onValueChange={setEnvironment}>
            <SelectTrigger size="sm" id="workspace-environment" aria-label="환경"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="local">Local · 샘플</SelectItem>
              <SelectItem value="dev">Development · 샘플</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>
      <Separator />
      <div className="workspace-body">
        <CollectionSidebar requests={requests} selectedId={activeId ?? undefined} onSelect={openRequest} />
        <Separator orientation="vertical" className="workspace-sidebar-divider" />
        <Tabs className="workspace-main" value={activeId ?? ''} onValueChange={setActiveId}>
          <div className="workspace-tab-bar">
            <WorkspaceTabs tabs={tabs} onClose={closeTab} />
          </div>
          <Separator />
          {activeTab ? (
            <TabsContent className="workspace-content" key={activeTab.request.id} value={activeTab.request.id}>
              <RequestEditor
                request={activeTab.request}
                dirty={JSON.stringify(activeTab.request) !== JSON.stringify(activeTab.saved)}
                running={activeTab.execution.status === 'running'}
                onChange={(request) => updateTab(request.id, (tab) => ({ ...tab, request }))}
                onSave={() => {
                  updateTab(activeTab.request.id, (tab) => ({ ...tab, saved: tab.request }))
                  setRequests((current) => current.map((request) =>
                    request.id === activeTab.request.id ? activeTab.request : request))
                  setNotice(`${activeTab.request.name}: 메모리에 저장했습니다.`)
                }}
                onRun={runSample}
                onCancel={cancelSample}
              />
              <ResponseViewer execution={activeTab.execution} />
            </TabsContent>
          ) : (
            <Empty className="workspace-empty">
              <EmptyHeader>
                <EmptyMedia variant="icon"><FolderOpen aria-hidden="true" /></EmptyMedia>
                <EmptyTitle>작업할 API를 선택하세요</EmptyTitle>
                <EmptyDescription>컬렉션에서 API를 선택하면 편집 탭이 열립니다.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </Tabs>
      </div>
      <Separator />
      <footer className="workspace-statusbar">
        <Badge className="agent-status" variant="outline"><Unplug aria-hidden="true" />에이전트 미연결</Badge>
        <div className="workspace-notice">
          <p className="workspace-demo-notice">샘플 응답은 입력값과 무관한 고정 예시이며 시간·크기는 실측값이 아닙니다. 실제 호출·파일 저장은 수행하지 않으며 새로고침 시 변경이 초기화됩니다.</p>
          <span className="workspace-action-notice" role="status">{notice}</span>
        </div>
        <Badge className="open-tab-count" variant="secondary">{tabs.length}개 탭</Badge>
      </footer>
    </main>
  )
}

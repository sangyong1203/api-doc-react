import { useEffect, useRef, useState } from 'react'
import { Braces, FolderOpen } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { CollectionSidebar } from '@/features/collections/components/CollectionSidebar'
import { CollectionEditDialog } from '@/features/collections/components/CollectionEditDialog'
import type { CollectionDeleteTarget, CollectionDialogTarget, CollectionFormValues } from '@/features/collections/types'
import { getRequestBody, validateRequest, withDefaultBodyView } from '@/features/api-editor/requestSchema'
import { RequestEditor } from '@/features/api-editor/components/RequestEditor'
import { RequestToolbar } from '@/features/api-editor/components/RequestToolbar'
import { PayloadPicker } from '@/features/payload-presets/components/PayloadPicker'
import { applyPayload, copyPayload, type PayloadPreset } from '@/features/payload-presets/types'
import { ResponseViewer } from '@/features/request-runner/components/ResponseViewer'
import { WorkspaceTabs } from '@/features/workspace/components/WorkspaceTabs'
import { EnvironmentPicker } from '@/features/environments/components/EnvironmentPicker'
import { createSampleResponse, SAMPLE_COLLECTIONS, SAMPLE_FOLDERS, SAMPLE_REQUESTS } from '@/features/workspace/fixtures/sampleWorkspace'
import type { RequestField, SampleRequest, WorkspaceTab } from '@/features/workspace/types'
import '@/styles/workspace.css'

function createInitialPreset(request: SampleRequest): PayloadPreset {
  return { id: `${request.id}-preset-1`, name: '입력 세트 1', description: '', values: copyPayload(request) }
}

function createTab(request: SampleRequest, preset = createInitialPreset(request)): WorkspaceTab {
  const values = withDefaultBodyView(applyPayload(request, preset.values))
  return { request: values, saved: values, selectedPresetId: preset.id, execution: { status: 'idle' }, requestSnapshot: null }
}

function copyActiveFields(fields: RequestField[]): Array<Pick<RequestField, 'name' | 'value'>> {
  return fields
    .filter((field) => field.enabled && field.name.trim())
    .map(({ name, value }) => ({ name, value }))
}

export function WorkspacePage() {
  const [collections, setCollections] = useState(SAMPLE_COLLECTIONS)
  const [folders, setFolders] = useState(SAMPLE_FOLDERS)
  const [requests, setRequests] = useState(SAMPLE_REQUESTS)
  const [presetsByApi, setPresetsByApi] = useState<Record<string, PayloadPreset[]>>(() => Object.fromEntries(SAMPLE_REQUESTS.map((request) => [request.id, [createInitialPreset(request)]])))
  const [defaultPresets, setDefaultPresets] = useState<Record<string, string | null>>({})
  const [requestError, setRequestError] = useState<{ id: string; message: string } | null>(null)
  const [confirmation, setConfirmation] = useState<{
    title: string
    description: string
    actionLabel: string
    onConfirm: () => void
  } | null>(null)
  const [editTarget, setEditTarget] = useState<CollectionDialogTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CollectionDeleteTarget | null>(null)
  const [tabs, setTabs] = useState<WorkspaceTab[]>([createTab(SAMPLE_REQUESTS[0])])
  const [activeId, setActiveId] = useState<string | null>(SAMPLE_REQUESTS[0].id)
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const activeTab = tabs.find((tab) => tab.request.id === activeId)
  const deleteRequests = deleteTarget ? requests.filter((request) => deleteTarget.kind === 'collection'
    ? request.collectionId === deleteTarget.id : deleteTarget.kind === 'folder'
      ? request.folderId === deleteTarget.id : request.id === deleteTarget.id) : []
  const deleteRequestIds = new Set(deleteRequests.map((request) => request.id))
  const deleteFolderCount = deleteTarget?.kind === 'collection' ? folders.filter((folder) => folder.collectionId === deleteTarget.id).length : 0
  const affectedTabs = tabs.filter((tab) => deleteRequestIds.has(tab.request.id))
  const dirtyDeleteCount = affectedTabs.filter((tab) => JSON.stringify(tab.request) !== JSON.stringify(tab.saved)).length
  const runningDeleteCount = affectedTabs.filter((tab) => tab.execution.status === 'running').length

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
      const presets = presetsByApi[request.id] ?? [createInitialPreset(request)]
      const preset = presets.find((item) => item.id === defaultPresets[request.id]) ?? presets[0]
      const tab = createTab(request, preset)
      setTabs((current) => [...current, tab])
    }
    setActiveId(request.id)
  }

  function beginEdit(target: CollectionDialogTarget) {
    // API 기본 정보는 저장 전 열린 탭의 최신 값으로 편집합니다.
    if (target.kind === 'api' && target.request) {
      const draft = tabs.find((tab) => tab.request.id === target.request?.id)?.request
      setEditTarget(draft ? { ...target, request: draft, collectionId: draft.collectionId, folderId: draft.folderId } : target)
    } else {
      setEditTarget(target)
    }
  }

  function submitEntity(values: CollectionFormValues): string | null {
    if (!editTarget) { return '편집할 항목을 선택하세요.' }
    const { name, collectionId, folderId, method, url } = values
    if (editTarget.kind === 'collection') {
      const id = editTarget.collection?.id
      if (collections.some((item) => item.id !== id && item.name.toLowerCase() === name.toLowerCase())) {
        return '같은 이름의 컬렉션이 있습니다.'
      }
      setCollections((current) => id ? current.map((item) => item.id === id ? { ...item, name } : item) : [...current, { id: crypto.randomUUID(), name }])
    } else if (editTarget.kind === 'folder') {
      const id = editTarget.folder?.id
      if (folders.some((item) => item.id !== id && item.collectionId === collectionId && item.name.toLowerCase() === name.toLowerCase())) {
        return '이 컬렉션에 같은 이름의 폴더가 있습니다.'
      }
      setFolders((current) => id ? current.map((item) => item.id === id ? { ...item, name } : item) : [...current, { id: crypto.randomUUID(), collectionId, name }])
    } else {
      if (!collections.some((item) => item.id === collectionId)
        || (folderId !== null && !folders.some((item) => item.id === folderId && item.collectionId === collectionId))) {
        return '유효한 컬렉션과 폴더를 선택하세요.'
      }
      const id = editTarget.request?.id
      if (requests.some((item) => item.id !== id && item.collectionId === collectionId && item.folderId === folderId && item.name.toLowerCase() === name.toLowerCase())) {
        return '이 위치에 같은 이름의 API가 있습니다.'
      }
      const patch = { name, collectionId, folderId, method, url }
      if (id) {
        setRequests((current) => current.map((request) => request.id === id ? { ...request, ...patch } : request))
        // 기본 정보만 적용해 params·body·오류 응답의 미저장 편집은 보존합니다.
        updateTab(id, (tab) => ({ ...tab, request: { ...tab.request, ...patch }, saved: { ...tab.saved, ...patch } }))
      } else {
        const request: SampleRequest = { id: crypto.randomUUID(), ...patch, pathParams: [], queryParams: [], headers: [], body: '', errorResponses: [] }
        setRequests((current) => [...current, request])
        setPresetsByApi((current) => ({ ...current, [request.id]: [createInitialPreset(request)] }))
        setTabs((current) => [...current, createTab(request)])
        setActiveId(request.id)
      }
    }
    return null
  }

  function deleteEntity() {
    if (!deleteTarget) { return }
    // 포함 API의 실행을 먼저 해제하여 삭제 이후 결과가 다시 생성되지 않게 합니다.
    deleteRequestIds.forEach((id) => { clearTimeout(timers.current.get(id)); timers.current.delete(id) })
    setRequests((current) => current.filter((request) => !deleteRequestIds.has(request.id)))
    setPresetsByApi((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !deleteRequestIds.has(id))))
    const remaining = tabs.filter((tab) => !deleteRequestIds.has(tab.request.id))
    setTabs(remaining)
    if (activeId && deleteRequestIds.has(activeId)) { setActiveId(remaining[0]?.request.id ?? null) }
    if (deleteTarget.kind === 'collection') {
      setCollections((current) => current.filter((item) => item.id !== deleteTarget.id))
      setFolders((current) => current.filter((item) => item.collectionId !== deleteTarget.id))
    } else if (deleteTarget.kind === 'folder') {
      setFolders((current) => current.filter((item) => item.id !== deleteTarget.id))
    }
    setDeleteTarget(null)
  }

  function closeTab(id: string, confirmed = false) {
    const target = tabs.find((tab) => tab.request.id === id)
    if (!target) {
      return
    }
    const dirty = JSON.stringify(target.request) !== JSON.stringify(target.saved)
    if (!confirmed && (dirty || target.execution.status === 'running')) {
      setConfirmation({ title: `${target.request.name} 탭 닫기`,
        description: `${dirty ? '미저장 변경이 사라집니다. ' : ''}${target.execution.status === 'running' ? '실행 중인 요청을 중단합니다. ' : ''}탭을 닫으시겠습니까?`,
        actionLabel: '탭 닫기', onConfirm: () => closeTab(id, true) })
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

  function selectPreset(id: string | null, confirmed = false) {
    if (!activeTab || id === activeTab.selectedPresetId) { return }
    const base = requests.find((request) => request.id === activeTab.request.id)
    const preset = (presetsByApi[activeTab.request.id] ?? []).find((item) => item.id === id)
    if (!base || (id && !preset)) { return }
    if (!confirmed && JSON.stringify(copyPayload(activeTab.request)) !== JSON.stringify(copyPayload(activeTab.saved))) {
      setConfirmation({ title: '입력 세트 전환', description: '현재 입력값의 미저장 변경을 버리고 세트를 전환하시겠습니까?',
        actionLabel: '변경 버리고 전환', onConfirm: () => selectPreset(id, true) })
      return
    }
    const values = copyPayload(preset?.values ?? base)
    updateTab(activeTab.request.id, (tab) => ({ ...tab, selectedPresetId: id,
      request: withDefaultBodyView(applyPayload(tab.request, values)), saved: withDefaultBodyView(applyPayload(tab.saved, values)) }))
  }

  function addPreset() {
    if (!activeTab) { return }
    const presets = presetsByApi[activeTab.request.id] ?? []
    let suffix = 1
    while (presets.some((item) => item.name === `입력 세트 ${suffix}`)) { suffix += 1 }
    const preset = { id: crypto.randomUUID(), name: `입력 세트 ${suffix}`, description: '', values: copyPayload(activeTab.request) }
    setPresetsByApi((current) => ({ ...current, [activeTab.request.id]: [...presets, preset] }))
    updateTab(activeTab.request.id, (tab) => ({ ...tab, selectedPresetId: preset.id,
      saved: applyPayload(tab.saved, preset.values) }))
  }

  function deletePreset(id: string, confirmed = false) {
    if (!activeTab) { return }
    const presets = presetsByApi[activeTab.request.id] ?? []
    if (presets.length <= 1) { return }
    const remaining = presets.filter((item) => item.id !== id)
    const fallback = remaining.find((item) => item.id === defaultPresets[activeTab.request.id]) ?? remaining[0]
    const target = presets.find((item) => item.id === id)
    const dirty = activeTab.selectedPresetId === id && JSON.stringify(copyPayload(activeTab.request)) !== JSON.stringify(copyPayload(activeTab.saved))
    if (!target) { return }
    if (!confirmed) {
      setConfirmation({ title: '입력 세트 삭제',
        description: `'${target.name}' 입력 세트를 삭제하시겠습니까?${dirty ? ' 현재 입력의 미저장 변경도 사라집니다.' : ''}`,
        actionLabel: '삭제', onConfirm: () => deletePreset(id, true) })
      return
    }
    if (activeTab.selectedPresetId === id) {
      updateTab(activeTab.request.id, (tab) => ({ ...tab, selectedPresetId: fallback.id,
        request: withDefaultBodyView(applyPayload(tab.request, fallback.values)), saved: withDefaultBodyView(applyPayload(tab.saved, fallback.values)) }))
    }
    setPresetsByApi((current) => ({ ...current, [activeTab.request.id]: presets.filter((item) => item.id !== id) }))
    if (defaultPresets[activeTab.request.id] === id) { setDefaultPresets((current) => ({ ...current, [activeTab.request.id]: fallback.id })) }
  }

  // 요청 ID별 타이머를 관리해 탭 전환·취소·닫기 후 다른 탭에 결과가 섞이지 않게 합니다.
  function runSample() {
    if (!activeTab || timers.current.has(activeTab.request.id)) {
      return
    }
    const { request } = activeTab
    const error = validateRequest(request)
    if (error) { setRequestError({ id: request.id, message: error }); return }
    setRequestError(null)
    // 실행 이후 편집과 독립적으로 당시 본문·파라미터·헤더를 유지합니다.
    const requestSnapshot = {
      bodyFormat: request.bodyFormat ?? 'json',
      body: getRequestBody(request),
      pathParams: copyActiveFields(request.pathParams),
      queryParams: copyActiveFields(request.queryParams),
      headers: copyActiveFields(request.headers),
    }
    updateTab(request.id, (tab) => ({ ...tab, execution: { status: 'running' }, requestSnapshot }))
    const timer = setTimeout(() => {
      timers.current.delete(request.id)
      updateTab(request.id, (tab) => ({ ...tab,
        execution: { status: 'complete', response: createSampleResponse(request.id, request.method) },
      }))
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
        <EnvironmentPicker />
      </header>
      <Separator />
      <div className="workspace-body">
        <CollectionSidebar collections={collections} folders={folders} requests={requests} selectedId={activeId ?? undefined} onSelect={openRequest} onEdit={beginEdit} onDelete={setDeleteTarget} />
        <Separator orientation="vertical" className="workspace-sidebar-divider" />
        <Tabs className="workspace-main" value={activeId ?? ''} onValueChange={setActiveId}>
          <div className="workspace-tab-bar">
            <WorkspaceTabs tabs={tabs} onClose={closeTab} />
          </div>
          <Separator />
          {activeTab ? (
            <TabsContent className="workspace-content" key={activeTab.request.id} value={activeTab.request.id}>
              <RequestToolbar
                request={activeTab.request}
                collectionName={collections.find((item) => item.id === activeTab.request.collectionId)?.name ?? ''}
                folderName={folders.find((item) => item.id === activeTab.request.folderId)?.name}
                dirty={JSON.stringify(activeTab.request) !== JSON.stringify(activeTab.saved)}
                running={activeTab.execution.status === 'running'}
                onChange={(request) => { setRequestError(null); updateTab(request.id, (tab) => ({ ...tab, request })) }}
                onSave={() => {
                  const error = validateRequest(activeTab.request)
                  if (error) { setRequestError({ id: activeTab.request.id, message: error }); return }
                  setRequestError(null)
                  updateTab(activeTab.request.id, (tab) => ({ ...tab, saved: tab.request }))
                  if (activeTab.selectedPresetId) {
                    const selectedId = activeTab.selectedPresetId
                    setPresetsByApi((current) => ({ ...current, [activeTab.request.id]: (current[activeTab.request.id] ?? []).map((preset) =>
                      preset.id === selectedId ? { ...preset, values: copyPayload(activeTab.request) } : preset) }))
                  }
                  setRequests((current) => current.map((request) => request.id === activeTab.request.id
                    ? (activeTab.selectedPresetId ? applyPayload(activeTab.request, copyPayload(request)) : activeTab.request) : request))
                }}
                onRun={runSample}
                onCancel={cancelSample}
              />
              {requestError?.id === activeTab.request.id && <p className="request-validation-error px-6 pb-2 text-sm text-error" role="alert">{requestError.message}</p>}
              <div className="request-response-layout">
                <RequestEditor
                  payloadPicker={<PayloadPicker presets={presetsByApi[activeTab.request.id] ?? []} selectedId={activeTab.selectedPresetId}
                    defaultId={defaultPresets[activeTab.request.id] ?? presetsByApi[activeTab.request.id]?.[0]?.id ?? null} onSelect={selectPreset} onAdd={addPreset} onDelete={deletePreset}
                    onDefault={(id) => setDefaultPresets((current) => ({ ...current, [activeTab.request.id]: id }))}
                    onRename={(id, name) => setPresetsByApi((current) => ({ ...current, [activeTab.request.id]: (current[activeTab.request.id] ?? []).map((preset) => preset.id === id ? { ...preset, name } : preset) }))} />}
                  request={activeTab.request}
                  onChange={(request) => { setRequestError(null); updateTab(request.id, (tab) => ({ ...tab, request })) }}
                />
                <ResponseViewer execution={activeTab.execution} requestSnapshot={activeTab.requestSnapshot} />
              </div>
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
      <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open) { setConfirmation(null) } }}>
        <AlertDialogContent className="workspace-confirmation-dialog">
          <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirmation?.description}</AlertDialogDescription>
          <div className="confirmation-actions flex justify-end gap-2">
            <AlertDialogCancel asChild><Button variant="outline">취소</Button></AlertDialogCancel>
            <AlertDialogAction asChild><Button variant="destructive" onClick={() => confirmation?.onConfirm()}>{confirmation?.actionLabel}</Button></AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
      {editTarget && <CollectionEditDialog target={editTarget} collections={collections} folders={folders} onClose={() => setEditTarget(null)} onSubmit={submitEntity} />}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) { setDeleteTarget(null) } }}>
        <DialogContent className="collection-delete-dialog">
          <DialogTitle>{deleteTarget?.name} 삭제</DialogTitle>
          <DialogDescription>
            {deleteTarget?.kind === 'api' ? '이 API를 삭제하시겠습니까?' : '이 항목과 포함된 폴더·API를 함께 삭제하시겠습니까?'} 현재 메모리의 변경은 되돌릴 수 없습니다.
          </DialogDescription>
          <div className="delete-impact grid gap-2 text-sm">
            {deleteTarget?.kind === 'collection' && <p>포함된 폴더 {deleteFolderCount}개</p>}
            <p>삭제할 API {deleteRequests.length}개 · 닫힐 작업 탭 {affectedTabs.length}개</p>
            {dirtyDeleteCount > 0 && <p className="delete-unsaved-warning text-warning">미저장 작업 {dirtyDeleteCount}개의 변경 사항이 사라집니다.</p>}
            {runningDeleteCount > 0 && <p className="delete-running-warning text-warning">실행 중인 요청 {runningDeleteCount}개를 중단합니다.</p>}
          </div>
          <div className="collection-dialog-actions flex justify-end gap-2">
            <Button variant="outline" autoFocus onClick={() => setDeleteTarget(null)}>취소</Button>
            <Button variant="destructive" onClick={deleteEntity}>삭제</Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  )
}

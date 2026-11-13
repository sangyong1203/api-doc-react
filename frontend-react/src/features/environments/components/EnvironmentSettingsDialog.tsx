import { useId, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { RequestField } from '@/features/workspace/types'
import type { Environment } from '../types'

type EnvironmentSettingsDialogProps = {
  environments: Environment[]
  selectedId: string | null
  onSave: (environments: Environment[]) => void
  onClose: () => void
}

type PendingAction = { kind: 'delete'; id: string } | { kind: 'close' }

export function EnvironmentSettingsDialog({ environments, selectedId, onSave, onClose }: EnvironmentSettingsDialogProps) {
  const [drafts, setDrafts] = useState(environments)
  const [editingId, setEditingId] = useState<string | null>(selectedId ?? environments[0]?.id ?? null)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const errorId = useId()
  const active = drafts.find((environment) => environment.id === editingId)
  const dirty = JSON.stringify(drafts) !== JSON.stringify(environments)
  const deleteTarget = pendingAction?.kind === 'delete' ? drafts.find((environment) => environment.id === pendingAction.id) : undefined

  function closeSettings() {
    if (dirty) { setPendingAction({ kind: 'close' }) } else { onClose() }
  }

  function updateEnvironment(patch: Partial<Pick<Environment, 'name' | 'variables'>>) {
    setDrafts((current) => current.map((environment) => environment.id === editingId ? { ...environment, ...patch } : environment))
    setError(null)
  }

  function updateVariable(variableId: string, patch: Partial<RequestField>) {
    if (!active) { return }
    updateEnvironment({ variables: active.variables.map((variable) => variable.id === variableId ? { ...variable, ...patch } : variable) })
  }

  function addEnvironment() {
    let name = '새 환경'
    let suffix = 2
    while (drafts.some((environment) => environment.name.trim() === name)) {
      name = `새 환경 ${suffix}`
      suffix += 1
    }
    const id = crypto.randomUUID()
    setDrafts((current) => [...current, { id, name, variables: [] }])
    setEditingId(id)
    setError(null)
  }

  function saveSettings() {
    const names = new Set<string>()
    // 전체 초안을 검증해 다른 환경에 남아 있는 오류도 저장 전에 안내합니다.
    for (const environment of drafts) {
      const name = environment.name.trim()
      let message: string | null = null
      if (!name) { message = '환경 이름을 입력하세요.' }
      else if (names.has(name.toLowerCase())) { message = '같은 이름의 환경이 있습니다.' }
      names.add(name.toLowerCase())
      const keys = new Set<string>()
      for (const variable of environment.variables) {
        const key = variable.name.trim()
        if (!key && variable.value.trim()) { message ??= '값이 있는 변수의 키를 입력하세요.' }
        if (key && keys.has(key)) { message ??= `변수 키 '${key}'가 중복됩니다.` }
        if (key) { keys.add(key) }
      }
      if (message) {
        setEditingId(environment.id)
        setError(message)
        return
      }
    }
    onSave(drafts.map((environment) => ({ ...environment, name: environment.name.trim(), variables: environment.variables.map((variable) => ({ ...variable, name: variable.name.trim() })) })))
  }

  function confirmAction() {
    if (pendingAction?.kind === 'close') { onClose(); return }
    if (pendingAction?.kind !== 'delete') { return }
    const remaining = drafts.filter((environment) => environment.id !== pendingAction.id)
    setDrafts(remaining)
    if (editingId === pendingAction.id) { setEditingId(remaining[0]?.id ?? null) }
    setPendingAction(null)
    setError(null)
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) { closeSettings() } }}>
      <DialogContent className="environment-settings-dialog flex h-[660px] max-w-3xl flex-col overflow-hidden" aria-describedby={undefined}>
        <DialogTitle>환경 설정</DialogTitle>
        <div className="environment-settings-layout grid min-h-0 flex-1 gap-6 overflow-y-auto [scrollbar-gutter:stable] sm:grid-cols-[160px_minmax(0,1fr)]">
          <aside className="environment-settings-sidebar flex min-h-0 min-w-0 flex-col gap-2" aria-label="편집할 환경">
            <div className="environment-list-heading flex h-6 shrink-0 items-start justify-between gap-2 pr-4">
              <span className="environment-list-title text-sm leading-5 font-medium">환경 목록</span>
              <Button className="environment-add" variant="ghost" size="icon-xs" aria-label="환경 추가" onClick={addEnvironment}><Plus aria-hidden="true" /></Button>
            </div>
            <div className="environment-settings-list flex min-h-0 max-h-72 flex-col gap-1 overflow-x-hidden overflow-y-auto p-1 pl-0 [scrollbar-gutter:stable] sm:h-0 sm:max-h-none sm:flex-1">
              {drafts.map((environment) => (
                <div className={`environment-list-row flex min-w-0 shrink-0 items-center rounded-lg transition-colors hover:bg-muted/50 ${environment.id === editingId ? 'bg-secondary' : ''}`} key={environment.id}>
                  <Button className="environment-edit-select min-w-0 flex-1 justify-start hover:bg-transparent dark:hover:bg-transparent active:translate-y-0!" variant="ghost" aria-pressed={environment.id === editingId} onClick={() => { setEditingId(environment.id); setError(null) }}>
                    <span className="truncate">{environment.name || '이름 없음'}</span>
                    {environment.id === selectedId && <Badge className="shrink-0 text-[10px]" variant="outline">사용 중</Badge>}
                  </Button>
                  <Button className="environment-delete mr-1 text-muted-foreground/60 hover:text-muted-foreground" variant="ghost" size="icon-xs" aria-label={`${environment.name || '이름 없음'} 환경 삭제`} onClick={() => setPendingAction({ kind: 'delete', id: environment.id })}><Trash2 aria-hidden="true" /></Button>
                </div>
              ))}
            </div>
          </aside>
          <section className="environment-settings-editor min-w-0" aria-label="환경 편집">
            {active ? (
              <div className="environment-edit-fields grid gap-4">
                <div className="environment-name-row flex items-end gap-2">
                  <label className="environment-name-field grid min-w-0 flex-1 gap-1.5 text-sm">환경 이름
                    <Input className="environment-name-input" maxLength={100} value={active.name} aria-describedby={error ? errorId : undefined} onChange={(event) => updateEnvironment({ name: event.target.value })} />
                  </label>
                </div>
                <div className="environment-variables-heading -mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">변수 목록</span>
                  <Button className="environment-variable-add" variant="ghost" size="sm" onClick={() => updateEnvironment({ variables: [...active.variables, { id: crypto.randomUUID(), enabled: true, name: '', value: '' }] })}><Plus aria-hidden="true" />행 추가</Button>
                </div>
                <div className="environment-variables-board h-[400px] overflow-auto rounded-lg border border-border px-2 [scrollbar-gutter:stable]">
                  <Table className="environment-variables-table table-fixed">
                    <TableHeader><TableRow>
                      <TableHead className="w-9"><span className="sr-only">사용</span></TableHead><TableHead className="pl-[15px] pr-1">키</TableHead><TableHead className="pl-[15px] pr-1">값</TableHead><TableHead className="w-9"><span className="sr-only">삭제</span></TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {active.variables.map((variable, index) => (
                        <TableRow key={variable.id}>
                          <TableCell className="px-1"><Checkbox checked={variable.enabled} aria-label={`환경 변수 ${index + 1}행 사용`} onCheckedChange={(checked) => updateVariable(variable.id, { enabled: checked === true })} /></TableCell>
                          <TableCell className="px-1"><Input className="environment-variable-key" placeholder="baseUrl" aria-label={`환경 변수 ${index + 1}행 키`} value={variable.name} onChange={(event) => updateVariable(variable.id, { name: event.target.value })} /></TableCell>
                          <TableCell className="px-1"><Input className="environment-variable-value" placeholder="값" aria-label={`환경 변수 ${index + 1}행 값`} value={variable.value} onChange={(event) => updateVariable(variable.id, { value: event.target.value })} /></TableCell>
                          <TableCell className="px-1"><Button className="environment-variable-delete text-muted-foreground/60 hover:text-muted-foreground" variant="ghost" size="icon-xs" aria-label={`환경 변수 ${index + 1}행 삭제`} onClick={() => updateEnvironment({ variables: active.variables.filter((item) => item.id !== variable.id) })}><Trash2 aria-hidden="true" /></Button></TableCell>
                        </TableRow>
                      ))}
                      {active.variables.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">등록된 변수가 없습니다.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : <p className="environment-settings-empty py-10 text-center text-sm text-muted-foreground">환경을 추가해 시작하세요.</p>}
          </section>
        </div>
        {error && <p className="environment-settings-error text-sm text-error" role="alert" id={errorId}>{error}</p>}
        <div className="environment-settings-footer flex shrink-0 items-center justify-end gap-2">
          {dirty && <Badge className="mr-auto" variant="secondary">미저장</Badge>}
          <Button variant="outline" onClick={closeSettings}>취소</Button>
          <Button disabled={!dirty} onClick={saveSettings}>저장</Button>
        </div>
        <Dialog open={Boolean(pendingAction)} onOpenChange={(open) => { if (!open) { setPendingAction(null) } }}>
          <DialogContent className="environment-confirm-dialog">
            <DialogTitle>{pendingAction?.kind === 'close' ? '변경 사항 취소' : '환경 삭제'}</DialogTitle>
            <DialogDescription>
              {pendingAction?.kind === 'close' ? '저장하지 않은 변경 사항을 버리고 닫으시겠습니까?' : `'${deleteTarget?.name || '이름 없음'}' 환경과 변수 ${deleteTarget?.variables.length ?? 0}개를 삭제하시겠습니까? 저장 시 적용됩니다.`}
            </DialogDescription>
            <div className="environment-confirm-actions flex justify-end gap-2">
              <Button variant="outline" autoFocus onClick={() => setPendingAction(null)}>돌아가기</Button>
              <Button variant="destructive" onClick={confirmAction}>{pendingAction?.kind === 'close' ? '변경 버리기' : '삭제'}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}

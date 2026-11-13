import { lazy, Suspense, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { MultipartEditor } from './MultipartEditor'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TabsContent } from '@/components/ui/tabs'
import { ViewTabs } from '@/components/ViewTabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import type { BodyField, FieldType, SampleRequest } from '@/features/workspace/types'
import { FIELD_TYPES, addBodyField, arrayPlaceholder, changeBodyFieldType, hasChildFields, getRequestBody, importBody, serializeBody, validateStructure } from '../requestSchema'

const JsonEditor = lazy(() => import('./JsonEditor').then((module) => ({ default: module.JsonEditor })))
type Props = { request: SampleRequest; onChange: (request: SampleRequest) => void; schemaOnly?: boolean }

export function BodyEditor({ request, onChange, schemaOnly = false }: Props) {
  const [error, setError] = useState('')
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [deleting, setDeleting] = useState<string[] | null>(null)
  const fields = request.schema?.body ?? []
  const values = request.bodyValues ?? {}
  const view = schemaOnly ? 'fields' : request.bodyView ?? 'json'
  const root = fields.find((field) => field.parentId === null)
  const rootContainer = root && hasChildFields(root.type)
  let bodyError = schemaOnly ? validateStructure(fields) ?? '' : ''
  if (!schemaOnly) {
    try { const body = getRequestBody(request); if (body.trim()) { JSON.parse(body) } } catch (cause) { bodyError = cause instanceof Error ? cause.message : '본문을 확인하세요.' }
  }

  function changeView(next: 'json' | 'fields') {
    if (view === next) { return }
    try {
      if (next === 'fields') {
        const imported = importBody(request.body, fields)
        onChange({ ...request, bodyView: next, bodyValues: imported.values, schema: { fields: request.schema?.fields ?? {}, body: imported.fields } })
      } else { onChange({ ...request, bodyView: next, body: serializeBody(fields, values) }) }
      setError('')
    } catch { setError(next === 'fields' ? '올바른 JSON만 필드 편집으로 전환할 수 있습니다. 원문은 유지됩니다.' : '필드의 키와 값 오류를 수정한 후 JSON으로 전환하세요.') }
  }

  function update(field: BodyField, patch: Partial<BodyField>) {
    if (patch.type && patch.type !== field.type) {
      try {
        const changed = changeBodyFieldType(fields, values, field, patch.type)
        onChange({ ...request, schema: { fields: request.schema?.fields ?? {}, body: changed.fields }, bodyValues: changed.values })
        setError('')
      } catch (cause) { setError(cause instanceof Error ? cause.message : '타입을 변경할 수 없습니다.') }
      return
    }
    onChange({ ...request, schema: { fields: request.schema?.fields ?? {}, body: fields.map((item) => item.id === field.id ? { ...item, ...patch } : item) } })
  }

  function add(parent: BodyField) {
    if (!hasChildFields(parent.type)) { return }
    const changed = addBodyField(fields, values, parent)
    setCollapsed(collapsed.filter((item) => item !== parent.id))
    onChange({ ...request, schema: { fields: request.schema?.fields ?? {}, body: changed.fields }, bodyValues: changed.values })
  }

  function requestDelete(field: BodyField) {
    const ids = [field.id]
    for (let index = 0; index < ids.length; index += 1) { ids.push(...fields.filter((item) => item.parentId === ids[index]).map((item) => item.id)) }
    if (ids.length > 1) { setDeleting(ids) } else { remove(ids) }
  }

  function remove(ids: string[]) {
    onChange({ ...request, schema: { fields: request.schema?.fields ?? {}, body: fields.filter((item) => !ids.includes(item.id)) }, bodyValues: Object.fromEntries(Object.entries(values).filter(([id]) => !ids.includes(id))) })
    setDeleting(null)
  }

  const rows: { field: BodyField; depth: number; arrayIndex: number | null; group?: string }[] = []
  function visit(parentId: string | null, depth: number, group?: string) {
    const parent = fields.find((item) => item.id === parentId)
    const children = fields.filter((item) => item.parentId === parentId)
    if (parent?.type === 'object array') {
      children.forEach((item, index) => visit(item.id, depth, children.length > 1 ? `항목 ${index + 1}` : undefined))
      return
    }
    children.forEach((field, index) => {
      rows.push({ field, depth, arrayIndex: parent?.type === 'array' ? index : null, group: index === 0 ? group : undefined })
      if (!collapsed.includes(field.id) && (hasChildFields(field.type))) { visit(field.id, depth + 1) }
    })
  }
  if (root && rootContainer) { visit(root.id, 0) } else { visit(null, 0) }

  return <ViewTabs variant="button" className="body-editor flex min-h-0 flex-1 flex-col gap-2" value={view} onValueChange={(next) => changeView(next as 'fields' | 'json')}
    label="본문 편집 방식" items={!schemaOnly && request.bodyFormat !== 'multipart' ? [{ value: 'fields', label: '필드 편집' }, { value: 'json', label: 'JSON' }] : []}
    toolbar={<>
        {!schemaOnly && <Select value={request.bodyFormat ?? 'json'} onValueChange={(format) => { setError(''); onChange({ ...request, bodyFormat: format as 'json' | 'multipart' }) }}>
          <SelectTrigger className="body-format-select w-40" aria-label="본문 형식"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="json">JSON</SelectItem><SelectItem value="multipart">Multipart Form</SelectItem></SelectContent>
        </Select>}
        {!schemaOnly && request.bodyFormat === 'multipart'
          ? <Button className="body-add-field" variant="ghost" size="sm" onClick={() => onChange({ ...request, multipartFields: [...request.multipartFields ?? [], { id: crypto.randomUUID(), name: '', enabled: true, value: '' }] })}><Plus />필드 추가</Button>
          : view === 'fields' && root && rootContainer && <Button className="body-add-field" variant="ghost" size="sm" onClick={() => add(root)}><Plus />{root.type === 'array' ? '항목 추가' : '필드 추가'}</Button>}
    </>}>

    {!schemaOnly && request.bodyFormat === 'multipart' ? <MultipartEditor request={request} onChange={onChange} /> : <>
    {(error || bodyError) && <p className="body-editor-error text-sm text-error" role="alert">{error || bodyError}</p>}
    <TabsContent className="body-editor-content min-h-0 flex-1 overflow-auto" value={view} aria-label={schemaOnly ? '응답 필드 명세' : undefined}>
      {view === 'json' ? <Suspense fallback={<p>편집기 준비 중…</p>}><JsonEditor initialValue={request.body} label="요청 JSON 본문" onChange={(body) => { setError(''); onChange({ ...request, body }) }} /></Suspense> :
        <Table className={`body-fields-table table-fixed [&_input]:bg-transparent! ${schemaOnly ? 'min-w-[820px]' : 'min-w-[1000px]'}`} aria-label={schemaOnly ? "응답 필드 명세" : "JSON 본문 필드 명세"}>
          <colgroup>
            <col className={schemaOnly ? 'w-[40%]' : 'w-[30%]'} />
            <col className="w-12" />
            <col className="w-44" />
            {!schemaOnly && <col className="w-[24%]" />}
            <col />
            <col className="w-[72px]" />
          </colgroup>
          <TableHeader className="bg-muted/50"><TableRow><TableHead>키</TableHead><TableHead className="text-center">필수</TableHead><TableHead>타입</TableHead>{!schemaOnly && <TableHead>값</TableHead>}<TableHead>설명</TableHead><TableHead><span className="sr-only">작업</span></TableHead></TableRow></TableHeader>
          <TableBody>{rows.map(({ field, depth, arrayIndex, group }) => {
            const container = hasChildFields(field.type)
            const label = `${schemaOnly ? '응답' : '본문'} ${field.parentId === null ? '값' : field.name}`
            return <TableRow key={field.id}>
              <TableCell>{group && <span className="body-array-item-label mb-1 block text-xs text-muted-foreground">{group}</span>}<div className="body-field-key flex min-w-0 items-center gap-1" style={{ paddingLeft: depth * 16 }}>
                <span className="body-field-toggle-slot flex size-6 shrink-0 items-center justify-center">{container && <Button size="icon-xs" variant="ghost" aria-label={`${label} ${collapsed.includes(field.id) ? '펼치기' : '접기'}`} onClick={() => setCollapsed(collapsed.includes(field.id) ? collapsed.filter((id) => id !== field.id) : [...collapsed, field.id])}>{collapsed.includes(field.id) ? <ChevronRight /> : <ChevronDown />}</Button>}</span>
                {field.parentId === null ? <span className="body-scalar-label text-muted-foreground">값</span> : <Input className="body-field-name min-w-16 flex-1" aria-label={`${label} 키`} value={arrayIndex === null ? field.name : `항목 ${arrayIndex + 1}`} readOnly={arrayIndex !== null} onChange={(event) => update(field, { name: event.target.value })} />}
              </div></TableCell>
              <TableCell className="required-cell px-0! text-center"><div className="required-checkbox flex w-full items-center justify-center"><Checkbox aria-label={`${label} 필수`} checked={field.required} onCheckedChange={(checked) => update(field, { required: checked === true })} /></div></TableCell>
              <TableCell><Select value={field.type} onValueChange={(type) => update(field, { type: type as FieldType })}><SelectTrigger className="field-type-select w-40 min-w-40 max-w-40 bg-transparent! hover:bg-transparent!" aria-label={`${label} 타입`}><SelectValue>{field.type === 'array' ? '타입 선택' : undefined}</SelectValue></SelectTrigger><SelectContent>{FIELD_TYPES.map((type) => <SelectItem key={type} value={type}>{type.endsWith(' array') ? `array (${type.split(' ')[0]})` : type}</SelectItem>)}</SelectContent></Select></TableCell>
              {!schemaOnly && <TableCell>{container ? <span className="body-child-hint block whitespace-normal text-xs leading-relaxed text-muted-foreground">오른쪽 &quot;+&quot; 버튼을 클릭해 하위 필드를 추가하세요.</span> : <Input placeholder={arrayPlaceholder(field.type)} aria-label={`${label} 값`} disabled={field.type === 'null'} value={field.type === 'null' ? 'null' : values[field.id] ?? ''} onChange={(event) => onChange({ ...request, bodyValues: { ...values, [field.id]: event.target.value } })} />}</TableCell>}
              <TableCell><Input aria-label={`${label} 설명`} value={field.description} onChange={(event) => update(field, { description: event.target.value })} /></TableCell>
              <TableCell><div className="body-field-actions flex">{container && <Button className="body-add-child [&_svg]:size-4" variant="ghost" size="icon-sm" aria-label={`${label} 하위 필드 추가`} onClick={() => add(field)}><Plus /></Button>}{field.parentId !== null && <Button variant="ghost" size="icon-xs" aria-label={`${label} 삭제`} onClick={() => requestDelete(field)}><Trash2 /></Button>}</div></TableCell>
            </TableRow>
          })}{rows.length === 0 && <TableRow><TableCell colSpan={schemaOnly ? 5 : 6} className="body-fields-empty text-muted-foreground">등록된 필드가 없습니다. 필드를 추가하세요.</TableCell></TableRow>}</TableBody>
        </Table>}
    </TabsContent>
    <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open) { setDeleting(null) } }}><AlertDialogContent><AlertDialogTitle>{schemaOnly ? '응답' : '본문'} 필드 삭제</AlertDialogTitle><AlertDialogDescription>하위 필드를 포함한 {deleting?.length}개 필드를 삭제하시겠습니까? API 공통 명세에서 제거됩니다.</AlertDialogDescription><div className="body-delete-actions flex justify-end gap-2"><AlertDialogCancel asChild><Button variant="outline">취소</Button></AlertDialogCancel><AlertDialogAction asChild><Button variant="destructive" onClick={() => { if (deleting) { remove(deleting) } }}>삭제</Button></AlertDialogAction></div></AlertDialogContent></AlertDialog>
    </>}
  </ViewTabs>
}

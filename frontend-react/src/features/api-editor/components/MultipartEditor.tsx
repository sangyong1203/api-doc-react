import { useId } from 'react'
import { Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { FieldSpec, SampleRequest } from '@/features/workspace/types'
import { DEFAULT_SPEC, fieldValueError } from '../requestSchema'

type Props = { request: SampleRequest; onChange: (request: SampleRequest) => void }

export function MultipartEditor({ request, onChange }: Props) {
  const inputId = useId()
  const fields = request.multipartFields ?? []
  const files = request.multipartFiles ?? {}

  function updateField(id: string, patch: Partial<(typeof fields)[number]>) {
    onChange({ ...request, multipartFields: fields.map((field) => field.id === id ? { ...field, ...patch } : field) })
  }

  function updateSpec(id: string, patch: Partial<FieldSpec>) {
    const previous = request.schema?.fields[id] ?? DEFAULT_SPEC
    onChange({ ...request, schema: { body: request.schema?.body ?? [], fields: { ...request.schema?.fields, [id]: { ...previous, ...patch } } } })
  }

  function removeFile(id: string) {
    const remaining = { ...files }
    delete remaining[id]
    onChange({ ...request, multipartFiles: remaining })
  }

  return <div className="multipart-editor flex min-h-0 flex-1 flex-col gap-2">
    <div className="multipart-table-scroll min-h-0 flex-1 overflow-auto">
      <Table className="multipart-fields-table min-w-[1000px] table-fixed [&_input]:bg-transparent!" aria-label="Multipart Form 필드">
        <colgroup><col className="w-12" /><col className="w-[24%]" /><col className="w-12" /><col className="w-44" /><col className="w-[28%]" /><col /><col className="w-12" /></colgroup>
        <TableHeader className="bg-muted/50"><TableRow><TableHead><span className="sr-only">사용</span></TableHead><TableHead>키</TableHead><TableHead className="text-center">필수</TableHead><TableHead>타입</TableHead><TableHead>값</TableHead><TableHead>설명</TableHead><TableHead><span className="sr-only">삭제</span></TableHead></TableRow></TableHeader>
        <TableBody>{fields.map((field, index) => {
          const spec = request.schema?.fields[field.id] ?? DEFAULT_SPEC
          const label = `Multipart ${index + 1}행`
          const file = files[field.id]?.file
          const valueError = field.enabled && spec.type !== 'file' ? fieldValueError(field.value, spec) : null
          return <TableRow key={field.id}>
            <TableCell><Checkbox aria-label={`${label} 사용`} checked={field.enabled} onCheckedChange={(checked) => updateField(field.id, { enabled: checked === true })} /></TableCell>
            <TableCell><Input aria-label={`${label} 키`} value={field.name} onChange={(event) => updateField(field.id, { name: event.target.value })} /></TableCell>
            <TableCell className="required-cell px-0! text-center"><div className="flex w-full justify-center"><Checkbox aria-label={`${label} 필수`} checked={spec.required} onCheckedChange={(checked) => updateSpec(field.id, { required: checked === true })} /></div></TableCell>
            <TableCell><Select value={spec.type} onValueChange={(type) => updateSpec(field.id, { type: type as FieldSpec['type'] })}><SelectTrigger className="field-type-select w-40 bg-transparent! hover:bg-transparent!" aria-label={`${label} 타입`}><SelectValue /></SelectTrigger><SelectContent>{(['string', 'number', 'boolean', 'file'] as const).map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select></TableCell>
            <TableCell>{spec.type === 'file' ? <div className="multipart-file-control flex min-w-0 items-center gap-1">
              <input className="multipart-file-input sr-only" id={`${inputId}-${field.id}`} type="file" aria-label={`${label} 파일 선택`} onChange={(event) => { const selected = event.target.files?.[0]; if (selected) { onChange({ ...request, multipartFiles: { ...files, [field.id]: { selectionId: crypto.randomUUID(), file: selected } } }) } event.target.value = '' }} />
              <Button asChild variant="outline" size="sm"><label htmlFor={`${inputId}-${field.id}`} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.control?.click() } }}><Upload />파일 선택</label></Button>
              <span className="multipart-file-name min-w-0 flex-1 truncate text-xs" title={file?.name}>{file?.name ?? '선택한 파일 없음'}</span>
              {file && <Button variant="ghost" size="icon-xs" aria-label={`${label} 파일 선택 해제`} onClick={() => removeFile(field.id)}><X /></Button>}
            </div> : <><Input aria-label={`${label} 값`} value={field.value} aria-invalid={Boolean(valueError)} onChange={(event) => updateField(field.id, { value: event.target.value })} />{valueError && <p className="multipart-value-error whitespace-normal text-xs text-error">{valueError}</p>}</>}</TableCell>
            <TableCell><Input aria-label={`${label} 설명`} value={spec.description} onChange={(event) => updateSpec(field.id, { description: event.target.value })} /></TableCell>
            <TableCell><Button variant="ghost" size="icon-xs" aria-label={`${label} 삭제`} onClick={() => { const remaining = { ...files }; delete remaining[field.id]; onChange({ ...request, multipartFields: fields.filter((item) => item.id !== field.id), multipartFiles: remaining }) }}><Trash2 /></Button></TableCell>
          </TableRow>
        })}{fields.length === 0 && <TableRow><TableCell colSpan={7} className="multipart-empty text-muted-foreground">필드를 추가해 텍스트 또는 파일을 입력하세요.</TableCell></TableRow>}</TableBody>
      </Table>
    </div>
    <p className="multipart-hint shrink-0 border-t pt-2 text-xs text-muted-foreground">파일은 세트별 메모리에만 유지됩니다. 현재 실행은 파일을 전송하지 않는 샘플입니다.</p>
  </div>
}

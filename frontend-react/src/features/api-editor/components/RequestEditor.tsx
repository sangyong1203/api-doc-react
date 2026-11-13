import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { BodyEditor } from './BodyEditor'
import { DEFAULT_SPEC, QUERY_FIELD_TYPES, arrayPlaceholder, isQueryArray, queryFieldError, fieldValueError } from '../requestSchema'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ErrorResponseExample, FieldSpec, RequestField, SampleRequest } from '@/features/workspace/types'


type RequestEditorProps = {
  payloadPicker: ReactNode
  request: SampleRequest
  onChange: (request: SampleRequest) => void
}

type RequestFieldsProps = {
  fields: RequestField[]
  specs?: Record<string, FieldSpec>
  path?: boolean
  query?: boolean
  onSpecChange?: (id: string, spec: FieldSpec) => void
  label: string
  onAdd?: () => void
  onChange: (fields: RequestField[]) => void
}

function RequestFields({ fields, specs = {}, path = false, query = false, onSpecChange, label, onAdd, onChange }: RequestFieldsProps) {
  function updateField(fieldId: string, patch: Partial<RequestField>) {
    onChange(fields.map((field) => field.id === fieldId ? { ...field, ...patch } : field))
  }

  return (
    <div className="request-fields">
      {onAdd && (
        <div className="response-field-actions mb-1 flex justify-end">
          <Button className="response-add-field" variant="ghost" size="sm" onClick={onAdd}>
            <Plus aria-hidden="true" />키·값 추가
          </Button>
        </div>
      )}
      <div className="fields-table-frame overflow-hidden">
        <Table className={onSpecChange ? `fields-table ${query ? 'min-w-[1080px]' : 'min-w-[900px]'} [&_input]:bg-transparent!` : "fields-table [&_input]:bg-transparent!"} aria-label={label}>
          <TableHeader className="fields-table-header bg-muted/50">
            <TableRow>
              <TableHead className="field-action-cell"><span className="sr-only">사용</span></TableHead>
              <TableHead>키</TableHead>
              {onSpecChange && <><TableHead className="w-12 text-center">필수</TableHead><TableHead className="w-44">타입</TableHead></>}
              <TableHead className={query ? 'w-[40%]' : undefined}>값</TableHead>
              {onSpecChange && <TableHead>설명</TableHead>}
              <TableHead className="field-action-cell"><span className="sr-only">삭제</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field, index) => {
              const spec = { ...(specs[field.id] ?? DEFAULT_SPEC), ...(path ? { required: true } : {}) }
              const error = field.enabled ? (query ? queryFieldError(field.value, spec) : fieldValueError(field.value, spec)) : null
              return (
              <TableRow key={field.id}>
                <TableCell>
                  <Checkbox
                    checked={path || field.enabled}
                    disabled={path}
                    aria-label={`${label} ${index + 1}행 사용`}
                    onCheckedChange={(checked) => updateField(field.id, { enabled: checked === true })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    className="field-input"
                    aria-label={`${label} ${index + 1}행 키`}
                    placeholder="Key"
                    value={field.name}
                    onChange={(event) => updateField(field.id, { name: event.target.value })}
                  />
                </TableCell>
                {onSpecChange && <>
                  <TableCell className="required-cell px-0! text-center"><div className="required-checkbox flex w-full items-center justify-center"><Checkbox aria-label={`${label} ${index + 1}행 필수`} checked={spec.required} disabled={path} onCheckedChange={(checked) => onSpecChange(field.id, { ...spec, required: checked === true })} /></div></TableCell>
                  <TableCell><Select value={spec.type} onValueChange={(type) => onSpecChange(field.id, { ...spec, type: type as FieldSpec['type'] })}><SelectTrigger className="field-type-select w-40 min-w-40 max-w-40 bg-transparent! hover:bg-transparent!" aria-label={`${label} ${index + 1}행 타입`}><SelectValue /></SelectTrigger><SelectContent>{(query ? QUERY_FIELD_TYPES : ['string', 'number', 'boolean']).map((type) => <SelectItem key={type} value={type}>{type.endsWith(' array') ? `array (${type.split(' ')[0]})` : type}</SelectItem>)}</SelectContent></Select></TableCell>
                </>}
                <TableCell>
                  <div className="field-value-controls flex min-w-0 items-center gap-2">
                  <Input
                    className="field-input"
                    aria-invalid={Boolean(error)}
                    aria-label={`${label} ${index + 1}행 값`}
                    placeholder={query ? arrayPlaceholder(spec.type) ?? 'Value' : 'Value'}
                    value={field.value}
                    onChange={(event) => updateField(field.id, { value: event.target.value })}
                  />
                {query && onSpecChange && isQueryArray(spec.type) && <Select value={spec.queryArrayFormat ?? 'repeat'} onValueChange={(format) => onSpecChange(field.id, { ...spec, queryArrayFormat: format as 'repeat' | 'comma' })}>
                  <SelectTrigger className="query-array-format w-32 shrink-0 bg-transparent! hover:bg-transparent!" aria-label={`${label} ${index + 1}행 전송 방식`}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="repeat">키 반복</SelectItem><SelectItem value="comma">쉼표 구분</SelectItem></SelectContent>
                </Select>}
                  </div>
                  {error && <span className="field-value-error block whitespace-normal text-xs text-error" role="status">{error}</span>}
                </TableCell>
                {onSpecChange && <TableCell><Input aria-label={`${label} ${index + 1}행 설명`} value={spec.description} onChange={(event) => onSpecChange(field.id, { ...spec, description: event.target.value })} /></TableCell>}
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`${label} ${index + 1}행 삭제`}
                    onClick={() => onChange(fields.filter((item) => item.id !== field.id))}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </TableCell>
              </TableRow>
            )})}
            {fields.length === 0 && (
              <TableRow>
                <TableCell colSpan={onSpecChange ? 7 : 4}>등록된 항목이 없습니다. 행을 추가해 입력하세요.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

type ErrorResponseCardProps = {
  response: ErrorResponseExample
  index: number
  onChange: (response: ErrorResponseExample) => void
  onDelete: () => void
}

function ErrorResponseCard({ response, index, onChange, onDelete }: ErrorResponseCardProps) {
  const statusInvalid = !/^[45]\d{2}$/.test(response.status)
  const statusErrorId = useId()
  const label = `오류 응답 ${index + 1}`

  return (
    <Card className="error-response-card" size="sm" role="group" aria-label={label}>
      <CardContent className="error-response-card-content flex flex-col gap-3">
        <div className="error-response-heading flex items-start gap-2">
          <label className="error-response-name flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs text-muted-foreground">이름</span>
            <Input aria-label={`${label} 이름`} placeholder="예: 인증 실패" value={response.name}
              onChange={(event) => onChange({ ...response, name: event.target.value })} />
          </label>
          <label className="error-response-status flex w-32 flex-col gap-1">
            <span className="text-xs text-muted-foreground">HTTP 상태 코드</span>
            <Input aria-label={`${label} 상태 코드`} inputMode="numeric" maxLength={3}
              aria-invalid={statusInvalid} aria-describedby={statusInvalid ? statusErrorId : undefined}
              value={response.status} onChange={(event) => onChange({ ...response, status: event.target.value })} />
          </label>
          <Button className="error-response-delete mt-5" variant="ghost" size="icon-sm"
            aria-label={`${label} 삭제`} onClick={onDelete}><Trash2 aria-hidden="true" /></Button>
        </div>
        {statusInvalid && <p className="error-response-status-error text-xs text-error" id={statusErrorId} role="status">상태 코드는 400~599로 입력하세요.</p>}
        <label className="error-response-description flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">설명</span>
          <Input aria-label={`${label} 설명`} placeholder="오류가 발생하는 상황을 입력하세요." value={response.description}
            onChange={(event) => onChange({ ...response, description: event.target.value })} />
        </label>
        <RequestFields fields={response.fields} label={`${label} 본문`}
          onAdd={() => onChange({ ...response, fields: [...response.fields, { id: crypto.randomUUID(), enabled: true, name: '', value: '' }] })}
          onChange={(fields) => onChange({ ...response, fields })} />
      </CardContent>
    </Card>
  )
}

export function RequestEditor({ request, onChange, payloadPicker }: RequestEditorProps) {
  const [section, setSection] = useState('query')
  const [tabScroll, setTabScroll] = useState({ overflowing: false, canScrollLeft: false, canScrollRight: false })
  const tabNavigationRef = useRef<HTMLDivElement>(null)
  const tabViewportRef = useRef<HTMLDivElement>(null)
  const tabListRef = useRef<HTMLDivElement>(null)
  const tabViewportId = useId()

  useEffect(() => {
    const navigation = tabNavigationRef.current
    const viewport = tabViewportRef.current
    const list = tabListRef.current
    if (!navigation || !viewport || !list) {
      return
    }

    function updateTabScroll() {
      if (!navigation || !viewport || !list) {
        return
      }
      const next = {
        // 화살표가 차지한 너비를 제외하지 않은 전체 영역을 기준으로 표시 여부를 결정합니다.
        // 버튼 등장으로 목록 폭이 줄어도 표시 여부가 반복해서 바뀌지 않습니다.
        overflowing: list.scrollWidth > navigation.clientWidth + 1,
        canScrollLeft: viewport.scrollLeft > 1,
        canScrollRight: viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1,
      }
      setTabScroll((current) => current.overflowing === next.overflowing
        && current.canScrollLeft === next.canScrollLeft
        && current.canScrollRight === next.canScrollRight ? current : next)
    }

    const observer = new ResizeObserver(updateTabScroll)
    observer.observe(navigation)
    observer.observe(viewport)
    observer.observe(list)
    viewport.addEventListener('scroll', updateTabScroll, { passive: true })
    return () => {
      observer.disconnect()
      viewport.removeEventListener('scroll', updateTabScroll)
    }
  }, [])

  // direction은 이전(-1) 또는 다음(1) 방향이며, 현재 보이는 폭의 약 3/4만큼 이동합니다.
  function scrollTabs(direction: -1 | 1) {
    const viewport = tabViewportRef.current
    if (!viewport) {
      return
    }
    viewport.scrollBy({
      left: direction * Math.max(120, viewport.clientWidth * 0.75),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }

  function addField() {
    if (section === 'body' || section === 'errors' || section === 'response') {
      return
    }
    const fieldKey = section === 'path' ? 'pathParams' : section === 'query' ? 'queryParams' : 'headers'
    onChange({
      ...request,
      [fieldKey]: [...request[fieldKey], { id: crypto.randomUUID(), enabled: true, name: '', value: '' }],
    })
  }

  function addErrorResponse() {
    onChange({ ...request, errorResponses: [...request.errorResponses, {
      id: crypto.randomUUID(), name: '', status: '400', description: '', fields: [],
    }] })
  }
  const sections = [
    { value: 'path', label: 'Path params', hasData: request.pathParams.some((field) => field.enabled && field.name.trim()) },
    { value: 'query', label: 'Query params', hasData: request.queryParams.some((field) => field.enabled && field.name.trim()) },
    { value: 'body', label: 'Body params', hasData: request.bodyFormat === 'multipart' ? Boolean(request.multipartFields?.some((field) => field.enabled && field.name.trim())) : Boolean(request.body.trim()) || Boolean(request.schema?.body.length) },
    { value: 'headers', label: 'Headers', hasData: request.headers.some((field) => field.enabled && field.name.trim()) },
    { value: 'response', label: '응답 명세', hasData: Boolean(request.responseFields?.length) },
    { value: 'errors', label: '오류 응답', hasData: request.errorResponses.length > 0 },
  ]
  function changeSpec(id: string, spec: FieldSpec) {
    const typeChanged = (request.schema?.fields[id]?.type ?? DEFAULT_SPEC.type) !== spec.type
    const clearValue = (fields: RequestField[]) => fields.map((field) => typeChanged && field.id === id ? { ...field, value: '' } : field)
    onChange({ ...request,
      pathParams: clearValue(request.pathParams), queryParams: clearValue(request.queryParams), headers: clearValue(request.headers),
      schema: { body: request.schema?.body ?? [], fields: { ...request.schema?.fields, [id]: spec } },
    })
  }

  return (
    <section className="request-editor" aria-label="요청 편집기">
      <Card className="request-sections-board" size="sm">
        <CardContent className="request-board-content">
          <Tabs className="request-sections" value={section} onValueChange={setSection}>
            <div className="request-sections-toolbar">
              <div className="request-tab-navigation" ref={tabNavigationRef}>
                {tabScroll.overflowing && (
                  <Button
                    className="request-tab-scroll-button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="요청 입력 탭 왼쪽으로 이동"
                    aria-controls={tabViewportId}
                    disabled={!tabScroll.canScrollLeft}
                    onClick={() => scrollTabs(-1)}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </Button>
                )}
                <div className="request-tab-list-scroll" id={tabViewportId} ref={tabViewportRef}>
                  <TabsList variant="line" className="request-tab-list gap-2 bg-transparent" aria-label="요청 입력 항목" ref={tabListRef}>
                    {sections.map((item) => (
                      <TabsTrigger className="request-section-trigger focus-visible:ring-0 focus-visible:outline-none focus-visible:border-transparent" key={item.value} value={item.value}>
                        <span className="request-section-label relative">
                          {item.label}
                          {item.hasData && (
                            <span className="request-section-indicator absolute -top-0.3 -right-1 size-1 rounded-full bg-primary" aria-hidden="true" />
                          )}
                        </span>
                        {item.hasData && <span className="sr-only">데이터 설정됨</span>}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
                {tabScroll.overflowing && (
                  <Button
                    className="request-tab-scroll-button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="요청 입력 탭 오른쪽으로 이동"
                    aria-controls={tabViewportId}
                    disabled={!tabScroll.canScrollRight}
                    onClick={() => scrollTabs(1)}
                  >
                    <ChevronRight aria-hidden="true" />
                  </Button>
                )}
              </div>
              {payloadPicker}
              {section !== 'body' && section !== 'response' && (
                <Button className="request-add-field" variant="ghost" size="sm" onClick={section === 'errors' ? addErrorResponse : addField}>
                  <Plus aria-hidden="true" />{section === 'errors' ? '오류 응답 추가' : '행 추가'}
                </Button>
              )}
            </div>
            <Separator className="request-section-divider" />
            <TabsContent className="request-section-content" value="path">
              <RequestFields fields={request.pathParams} specs={request.schema?.fields} path onSpecChange={changeSpec} label="Path params" onChange={(pathParams) => onChange({ ...request, pathParams })} />
            </TabsContent>
            <TabsContent className="request-section-content" value="query">
              <RequestFields fields={request.queryParams} query specs={request.schema?.fields} onSpecChange={changeSpec} label="Query params" onChange={(queryParams) => onChange({ ...request, queryParams })} />
            </TabsContent>
            <TabsContent className="request-section-content" value="headers">
              <RequestFields fields={request.headers} specs={request.schema?.fields} onSpecChange={changeSpec} label="Request headers" onChange={(headers) => onChange({ ...request, headers })} />
            </TabsContent>
            <TabsContent className="request-section-content error-responses-content" value="errors">
              <div className="error-response-list flex flex-col gap-3 p-1">
                {request.errorResponses.length === 0 && (
                  <p className="error-responses-empty py-6 text-center text-sm text-muted-foreground">등록된 오류 응답이 없습니다. 오류 응답을 추가하세요.</p>
                )}
                {request.errorResponses.map((response, index) => (
                  <ErrorResponseCard key={response.id} response={response} index={index}
                    onChange={(updated) => onChange({ ...request, errorResponses: request.errorResponses.map((item) => item.id === updated.id ? updated : item) })}
                    onDelete={() => onChange({ ...request, errorResponses: request.errorResponses.filter((item) => item.id !== response.id) })} />
                ))}
              </div>
            </TabsContent>
            <TabsContent className="request-section-content request-body-content" value="response">
              <BodyEditor schemaOnly request={{ ...request, schema: { fields: {}, body: request.responseFields ?? [{ id: 'response-root', parentId: null, name: '$', type: 'object', required: false, description: '' }] } }}
                onChange={(next) => onChange({ ...request, responseFields: next.schema?.body })} />
            </TabsContent>
            <TabsContent className="request-section-content request-body-content" value="body">
              <BodyEditor request={request} onChange={onChange} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </section>
  )
}

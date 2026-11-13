import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ErrorResponseExample, RequestField, SampleRequest } from '@/features/workspace/types'

const JsonEditor = lazy(() => import('./JsonEditor').then((module) => ({ default: module.JsonEditor })))

type RequestEditorProps = {
  request: SampleRequest
  onChange: (request: SampleRequest) => void
}

type RequestFieldsProps = {
  fields: RequestField[]
  label: string
  onAdd?: () => void
  onChange: (fields: RequestField[]) => void
}

function RequestFields({ fields, label, onAdd, onChange }: RequestFieldsProps) {
  function updateField(fieldId: string, patch: Partial<RequestField>) {
    onChange(fields.map((field) => field.id === fieldId ? { ...field, ...patch } : field))
  }

  return (
    <div className="request-fields">
      <div className="fields-heading">
        <span>{label}</span>
        {onAdd && (
          <Button className="response-add-field" variant="ghost" size="sm" onClick={onAdd}>
            <Plus aria-hidden="true" />키·값 추가
          </Button>
        )}
      </div>
      <Table className="fields-table">
        <TableHeader>
          <TableRow>
            <TableHead className="field-action-cell"><span className="sr-only">사용</span></TableHead>
            <TableHead>키</TableHead>
            <TableHead>값</TableHead>
            <TableHead className="field-action-cell"><span className="sr-only">삭제</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.map((field, index) => (
            <TableRow key={field.id}>
              <TableCell>
                <Checkbox
                  checked={field.enabled}
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
              <TableCell>
                <Input
                  className="field-input"
                  aria-label={`${label} ${index + 1}행 값`}
                  placeholder="Value"
                  value={field.value}
                  onChange={(event) => updateField(field.id, { value: event.target.value })}
                />
              </TableCell>
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
          ))}
          {fields.length === 0 && (
            <TableRow>
              <TableCell colSpan={4}>등록된 항목이 없습니다. 행을 추가해 입력하세요.</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
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

export function RequestEditor({ request, onChange }: RequestEditorProps) {
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
    if (section === 'body' || section === 'errors') {
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
    { value: 'body', label: 'Body params', hasData: Boolean(request.body.trim()) },
    { value: 'headers', label: 'Headers', hasData: request.headers.some((field) => field.enabled && field.name.trim()) },
    { value: 'errors', label: '오류 응답', hasData: request.errorResponses.length > 0 },
  ]
  let jsonError = false
  if (request.body.trim()) {
    try {
      JSON.parse(request.body)
    } catch {
      jsonError = true
    }
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
                  <TabsList aria-label="요청 입력 항목" ref={tabListRef}>
                    {sections.map((item) => (
                      <TabsTrigger className="request-section-trigger data-active:border-transparent! data-active:bg-primary! data-active:shadow-none!" key={item.value} value={item.value}>
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
              {section !== 'body' && (
                <Button className="request-add-field" variant="ghost" size="sm" onClick={section === 'errors' ? addErrorResponse : addField}>
                  <Plus aria-hidden="true" />{section === 'errors' ? '오류 응답 추가' : '행 추가'}
                </Button>
              )}
            </div>
            <Separator className="request-section-divider" />
            <TabsContent className="request-section-content" value="path">
              <RequestFields fields={request.pathParams} label="Path params" onChange={(pathParams) => onChange({ ...request, pathParams })} />
            </TabsContent>
            <TabsContent className="request-section-content" value="query">
              <RequestFields fields={request.queryParams} label="Query params" onChange={(queryParams) => onChange({ ...request, queryParams })} />
            </TabsContent>
            <TabsContent className="request-section-content" value="headers">
              <RequestFields fields={request.headers} label="Request headers" onChange={(headers) => onChange({ ...request, headers })} />
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
            <TabsContent className="request-section-content request-body-content" value="body">
              <div className="body-heading">
                <Badge variant="outline">JSON</Badge>
                {jsonError && <span className="body-warning text-sm text-error" role="status">올바른 JSON 형식이 아닙니다.</span>}
              </div>
              <div className="request-body-scroll">
                <Suspense fallback={<p className="editor-loading" role="status">편집기 준비 중…</p>}>
                  <JsonEditor initialValue={request.body} label="요청 JSON 본문" onChange={(body) => onChange({ ...request, body })} />
                </Suspense>
                {(request.method === 'GET' || request.method === 'HEAD') && (
                  <p className="body-hint">GET·HEAD 본문의 실제 전송 정책은 API 호출 구현 단계에서 확정합니다.</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </section>
  )
}

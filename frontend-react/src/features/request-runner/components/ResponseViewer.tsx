import { ArrowDownToLine, CircleAlert, LoaderCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { TabsContent } from '@/components/ui/tabs'
import { ViewTabs } from '@/components/ViewTabs'
import type { ExecutionState, RequestSnapshot } from '@/features/workspace/types'

type ResponseViewerProps = {
  execution: ExecutionState
  requestSnapshot: RequestSnapshot | null
}

function formatFields(fields: RequestSnapshot['headers']): string {
  return fields.map(({ name, value }) => `${name}: ${value}`).join('\n') || '(없음)'
}

function hasBodyPayload(body: string): boolean {
  if (!body.trim()) { return false }
  try {
    const value: unknown = JSON.parse(body)
    if (value !== null && typeof value === 'object') { return Object.keys(value).length > 0 }
  } catch { /* JSON이 아닌 본문도 내용이 있으면 표시합니다. */ }
  return true
}

export function ResponseViewer({ execution, requestSnapshot }: ResponseViewerProps) {
  const responseMetrics = execution.status === 'complete' ? (
    <div className="response-metrics">
      <Badge variant={execution.response.status >= 400 ? 'error' : 'success'}>
        {execution.response.status} {execution.response.statusText}
      </Badge>
      <Badge variant="outline">{execution.response.durationMs} ms</Badge>
      <Badge variant="outline">{execution.response.sizeBytes} B</Badge>
    </div>
  ) : null

  return (
    <section className="response-viewer" aria-label="요청 및 응답 결과">
      <Card className="response-board" size="sm">
        <CardContent className="response-board-content">
          <ViewTabs className="response-view-tabs" defaultValue="response" label="요청 및 응답 데이터" items={[
            { value: 'headers', label: 'Headers' }, { value: 'payload', label: 'Payload' }, { value: 'response', label: 'Response' },
          ]}>
            <Separator className="response-section-divider" />
            <TabsContent className="response-view-content" value="headers">
              {responseMetrics}
              <div className="exchange-data-sections">
                {requestSnapshot && <section className="exchange-data-section rounded-lg border border-border p-3" aria-label="Request URL">
                  <h3 className="exchange-data-title border-b border-border pb-2 text-xs font-medium text-muted-foreground">Request URL</h3>
                  <pre className="response-code whitespace-pre-wrap break-all"><code>{requestSnapshot.requestUrl}</code></pre>
                </section>}
                <section className="exchange-data-section rounded-lg border border-border p-3" aria-label="Request Headers">
                  <h3 className="exchange-data-title border-b border-border pb-2 text-xs font-medium text-muted-foreground">Request Headers</h3>
                  <pre className="response-code"><code>{requestSnapshot ? formatFields(requestSnapshot.headers) : '아직 실행한 요청이 없습니다.'}</code></pre>
                </section>
                <section className="exchange-data-section rounded-lg border border-border p-3" aria-label="Response Headers">
                  <h3 className="exchange-data-title border-b border-border pb-2 text-xs font-medium text-muted-foreground">Response Headers</h3>
                  <pre className="response-code"><code>{execution.status === 'complete' ? execution.response.headers || '(없음)' : '응답 헤더가 없습니다.'}</code></pre>
                </section>
                <p className="request-snapshot-notice">실행 시점의 입력값과 예시 응답입니다. 자동 헤더·변수 치환 전이며 실제 전송 내역은 아닙니다.</p>
              </div>
            </TabsContent>
            <TabsContent className="response-view-content" value="payload">
              {responseMetrics}
              {requestSnapshot ? (
                <div className="exchange-data-sections">
                  {requestSnapshot.pathParams.length > 0 && <section className="exchange-data-section rounded-lg border border-border p-3" aria-label="실행 당시 Path params">
                    <h3 className="exchange-data-title border-b border-border pb-2 text-xs font-medium text-muted-foreground">Path params</h3>
                    <pre className="response-code"><code>{formatFields(requestSnapshot.pathParams)}</code></pre>
                  </section>}
                  {requestSnapshot.queryParams.length > 0 && <section className="exchange-data-section rounded-lg border border-border p-3" aria-label="실행 당시 Query params">
                    <h3 className="exchange-data-title border-b border-border pb-2 text-xs font-medium text-muted-foreground">Query params</h3>
                    <pre className="response-code"><code>{formatFields(requestSnapshot.queryParams)}</code></pre>
                    {requestSnapshot.queryString && <><h4 className="query-string-title text-xs text-muted-foreground">Query string</h4>
                    <pre className="response-code whitespace-pre-wrap break-all"><code>{`?${requestSnapshot.queryString}`}</code></pre></>}
                  </section>}
                  {hasBodyPayload(requestSnapshot.body) && <section className="exchange-data-section rounded-lg border border-border p-3" aria-label="실행 당시 Request Body">
                    <h3 className="exchange-data-title border-b border-border pb-2 text-xs font-medium text-muted-foreground">Request Body{requestSnapshot.bodyFormat === 'multipart' ? ' · Multipart Form' : ''}</h3>
                    <pre className="response-code"><code>{requestSnapshot.body}</code></pre>
                  </section>}
                  <p className="request-snapshot-notice">실행 시작 시점의 입력값입니다. 실제 전송 내역은 아닙니다.</p>
                </div>
              ) : (
                <Empty className="request-snapshot-empty p-3">
                  <EmptyHeader>
                    <EmptyTitle>아직 실행한 요청이 없습니다</EmptyTitle>
                    <EmptyDescription>실행 후 당시의 Path·Query·Body를 확인할 수 있습니다.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </TabsContent>
            <TabsContent className="response-view-content" value="response" aria-busy={execution.status === 'running'}>
              {responseMetrics}
              {execution.status === 'complete' ? (
                <pre className="response-code"><code>{execution.response.body || '(본문 없음)'}</code></pre>
              ) : execution.status === 'error' ? (
                <Alert className="response-error" variant="error">
                  <CircleAlert aria-hidden="true" />
                  <AlertTitle>통신 오류</AlertTitle>
                  <AlertDescription>{execution.message}</AlertDescription>
                </Alert>
              ) : (
                <Empty className="response-placeholder p-3">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      {execution.status === 'running'
                        ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
                        : <ArrowDownToLine aria-hidden="true" />}
                    </EmptyMedia>
                    <EmptyTitle>
                      {execution.status === 'running' ? '응답 준비 중'
                        : execution.status === 'cancelled' ? '실행이 취소되었습니다'
                        : '응답을 확인할 준비가 되었습니다'}
                    </EmptyTitle>
                    <EmptyDescription>
                      {execution.status === 'running' ? '취소 버튼으로 실행을 중단할 수 있습니다.'
                        : '실행을 누르면 고정된 성공 응답을 표시합니다.'}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </TabsContent>
          </ViewTabs>
          <div className="sr-only" role="status">
            {execution.status === 'complete' ? `실행 완료: ${execution.response.status}`
              : execution.status === 'running' ? '실행 중'
              : execution.status === 'cancelled' ? '실행 취소됨'
              : execution.status === 'error' ? execution.message : ''}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

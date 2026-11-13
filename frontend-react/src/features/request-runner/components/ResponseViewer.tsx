import { ArrowDownToLine, CircleAlert, LoaderCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ExecutionState, RequestSnapshot } from '@/features/workspace/types'

type ResponseViewerProps = {
  execution: ExecutionState
  requestSnapshot: RequestSnapshot | null
}

function formatFields(fields: RequestSnapshot['headers']): string {
  return fields.map(({ name, value }) => `${name}: ${value}`).join('\n') || '(없음)'
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
          <Tabs className="response-view-tabs" defaultValue="response">
            <div className="response-heading">
              <TabsList variant="line" aria-label="요청 및 응답 데이터">
                <TabsTrigger value="headers">Headers</TabsTrigger>
                <TabsTrigger value="payload">Payload</TabsTrigger>
                <TabsTrigger value="response">Response</TabsTrigger>
              </TabsList>
            </div>
            <Separator className="response-section-divider" />
            <TabsContent className="response-view-content" value="headers">
              {responseMetrics}
              <div className="exchange-data-sections">
                <section className="exchange-data-section" aria-label="Request Headers">
                  <h3 className="exchange-data-title">Request Headers</h3>
                  <pre className="response-code"><code>{requestSnapshot ? formatFields(requestSnapshot.headers) : '아직 실행한 요청이 없습니다.'}</code></pre>
                </section>
                <section className="exchange-data-section" aria-label="Response Headers">
                  <h3 className="exchange-data-title">Response Headers</h3>
                  <pre className="response-code"><code>{execution.status === 'complete' ? execution.response.headers || '(없음)' : '응답 헤더가 없습니다.'}</code></pre>
                </section>
                <p className="request-snapshot-notice">샘플 실행 시점의 입력값과 예시 응답입니다. 자동 헤더·변수 치환 전이며 실제 전송 내역은 아닙니다.</p>
              </div>
            </TabsContent>
            <TabsContent className="response-view-content" value="payload">
              {responseMetrics}
              {requestSnapshot ? (
                <div className="exchange-data-sections">
                  <section className="exchange-data-section" aria-label="실행 당시 Path params">
                    <h3 className="exchange-data-title">Path params</h3>
                    <pre className="response-code"><code>{formatFields(requestSnapshot.pathParams)}</code></pre>
                  </section>
                  <section className="exchange-data-section" aria-label="실행 당시 Query params">
                    <h3 className="exchange-data-title">Query params</h3>
                    <pre className="response-code"><code>{formatFields(requestSnapshot.queryParams)}</code></pre>
                  </section>
                  <section className="exchange-data-section" aria-label="실행 당시 Request Body">
                    <h3 className="exchange-data-title">Request Body</h3>
                    <pre className="response-code"><code>{requestSnapshot.body || '(본문 없음)'}</code></pre>
                  </section>
                  <p className="request-snapshot-notice">샘플 실행 시작 시점의 입력값입니다. 실제 전송 내역은 아닙니다.</p>
                </div>
              ) : (
                <Empty className="request-snapshot-empty p-3">
                  <EmptyHeader>
                    <EmptyTitle>아직 실행한 요청이 없습니다</EmptyTitle>
                    <EmptyDescription>샘플 실행 후 당시의 Path·Query·Body를 확인할 수 있습니다.</EmptyDescription>
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
                  <AlertTitle>샘플 통신 오류</AlertTitle>
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
                      {execution.status === 'running' ? '샘플 응답 준비 중'
                        : execution.status === 'cancelled' ? '샘플 실행이 취소되었습니다'
                        : '응답을 확인할 준비가 되었습니다'}
                    </EmptyTitle>
                    <EmptyDescription>
                      {execution.status === 'running' ? '취소 버튼으로 실행을 중단할 수 있습니다.'
                        : '샘플 실행을 누르면 고정된 성공 응답을 표시합니다.'}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </TabsContent>
          </Tabs>
          <div className="sr-only" role="status">
            {execution.status === 'complete' ? `샘플 실행 완료: ${execution.response.status}`
              : execution.status === 'running' ? '샘플 실행 중'
              : execution.status === 'cancelled' ? '샘플 실행 취소됨'
              : execution.status === 'error' ? execution.message : ''}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { SampleRequest } from '@/features/workspace/types'
import { ApiDocumentation } from './ApiDocumentation'
import { downloadApiDocument } from '../downloadApiDocument'

type Props = {
  request: SampleRequest
  onClose: () => void
}

export function ApiDocumentationDialog({ request, onClose }: Props) {
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  async function download() {
    setDownloading(true)
    setDownloadError('')
    try { await downloadApiDocument(request) }
    catch { setDownloadError('문서를 다운로드하지 못했습니다. 다시 시도해 주세요.') }
    finally { setDownloading(false) }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) { onClose() } }}>
    <DialogContent className="api-document-dialog flex h-[90dvh] max-w-7xl flex-col overflow-hidden">
      <DialogTitle>{request.name} · 문서 미리보기</DialogTitle>
      <DialogDescription>현재 편집 중인 API 명세와 문서를 표시합니다. 설명과 예시는 요청 편집기의 문서 탭에서 작성할 수 있습니다.</DialogDescription>
      <ApiDocumentation request={request} />
      {downloadError && <p className="document-download-error text-sm text-error" role="alert">{downloadError}</p>}
      <div className="document-dialog-actions flex shrink-0 items-center justify-end gap-2">
        <Button className="document-download" variant="outline" disabled={downloading} onClick={download}>
          <Download aria-hidden="true" />{downloading ? '다운로드 중…' : '다운로드'}
        </Button>
        <Button variant="outline" onClick={onClose}>닫기</Button>
      </div>
    </DialogContent>
  </Dialog>
}

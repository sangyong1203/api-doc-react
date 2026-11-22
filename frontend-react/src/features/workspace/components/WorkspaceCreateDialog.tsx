import type { CreateWorkspaceResult } from '../types'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAppCloseProtection } from '@/hooks/useAppCloseProtection'

type Props = {
  onCreate: (name: string) => Promise<CreateWorkspaceResult>
  onClose: () => void
  native?: boolean
}

export function WorkspaceCreateDialog({ onCreate, onClose, native = false }: Props) {
  const nameId = useId()
  const errorId = useId()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useAppCloseProtection(name !== '', submitting)

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting) { onClose() } }}>
      <DialogContent className="workspace-create-dialog">
        <DialogTitle>새 작업 공간</DialogTitle>
        <DialogDescription className="workspace-create-description text-xs">
          {native ? '이름을 입력하고 폴더를 선택하면 빈 작업 공간을 만듭니다. 기존 작업 공간 파일과 관리 폴더는 덮어쓰지 않습니다.' : '이름을 입력하면 메모리에서 샘플 작업 공간을 만듭니다. 다시 불러오거나 앱을 종료하면 초기화됩니다.'}
        </DialogDescription>
        <form className="workspace-create-form flex flex-col gap-4" onSubmit={async (event) => {
          event.preventDefault()
          if (submitting) { return }
          setSubmitting(true)
          try { const result = await onCreate(name); setError(result.status === 'failed' ? result.message : null) } finally { setSubmitting(false) }
        }}>
          <div className="workspace-name-field flex flex-col gap-2">
            <label className="workspace-name-label text-sm" htmlFor={nameId}>작업 공간 이름</label>
            <Input className="workspace-name-input" id={nameId} maxLength={200} disabled={submitting} placeholder="예: 주문 API" value={name}
              aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
              onChange={(event) => { setName(event.target.value); setError(null) }} />
            {error && <p className="workspace-create-error text-xs text-error" id={errorId} role="alert">{error}</p>}
          </div>
          <div className="workspace-create-actions flex justify-end gap-2">
            <Button className="workspace-create-cancel" type="button" variant="outline" disabled={submitting} onClick={onClose}>취소</Button>
            <Button className="workspace-create-submit" type="submit" disabled={submitting}>{submitting ? '폴더 선택 중…' : '생성'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

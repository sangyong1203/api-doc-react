import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

type Props = {
  onCreate: (name: string) => string | null
  onClose: () => void
}

export function WorkspaceCreateDialog({ onCreate, onClose }: Props) {
  const nameId = useId()
  const errorId = useId()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <Dialog open onOpenChange={(open) => { if (!open) { onClose() } }}>
      <DialogContent className="workspace-create-dialog">
        <DialogTitle>새 작업 공간</DialogTitle>
        <DialogDescription className="workspace-create-description text-xs">
          * 이름을 입력하면 빈 작업 공간을 만듭니다. 현재는 메모리에만 보관하며 새로고침하면 초기화됩니다. 실제 작업 폴더 연결은 에이전트 개발 시 제공됩니다.
        </DialogDescription>
        <form className="workspace-create-form flex flex-col gap-4" onSubmit={(event) => {
          event.preventDefault()
          setError(onCreate(name))
        }}>
          <div className="workspace-name-field flex flex-col gap-2">
            <label className="workspace-name-label text-sm" htmlFor={nameId}>작업 공간 이름</label>
            <Input className="workspace-name-input" id={nameId} placeholder="예: 주문 API" value={name}
              aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
              onChange={(event) => { setName(event.target.value); setError(null) }} />
            {error && <p className="workspace-create-error text-xs text-error" id={errorId} role="alert">{error}</p>}
          </div>
          <div className="workspace-create-actions flex justify-end gap-2">
            <Button className="workspace-create-cancel" type="button" variant="outline" onClick={onClose}>취소</Button>
            <Button className="workspace-create-submit" type="submit">생성</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

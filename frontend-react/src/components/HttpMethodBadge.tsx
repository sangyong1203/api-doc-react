import { Badge } from '@/components/ui/badge'

export function HttpMethodBadge({ method }: { method: string }) {
  // 프리셋에 HTTP 메서드 전용 색상은 없어 기존 의미별 색상을 사용합니다.
  // DELETE는 프리셋의 destructive variant로 표현할 수 있습니다.
  return (
    <Badge
      className={method === 'DELETE' ? 'http-method-badge' : `http-method-badge method-${method.toLowerCase()}`}
      variant={method === 'DELETE' ? 'destructive' : 'outline'}
    >
      {method}
    </Badge>
  )
}

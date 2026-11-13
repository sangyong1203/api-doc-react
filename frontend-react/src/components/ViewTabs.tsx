import type { ComponentProps, ReactNode } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

type ViewTabsProps = Pick<ComponentProps<typeof Tabs>, 'value' | 'defaultValue' | 'onValueChange' | 'className'> & {
  label: string
  items: { value: string; label: ReactNode }[]
  toolbar?: ReactNode
  children: ReactNode
}

// 본문 보기와 결과 뷰어가 공유하는 밑줄 탭입니다. 콘텐츠는 TabsContent로 조합합니다.
export function ViewTabs({ label, items, toolbar, children, ...props }: ViewTabsProps) {
  return <Tabs {...props}>
    <div className="view-tabs-heading flex shrink-0 flex-wrap items-center gap-2">
      {items.length > 0 && <TabsList className="view-tabs-list" variant="line" aria-label={label}>
        {items.map((item) => <TabsTrigger className="view-tabs-trigger" key={item.value} value={item.value}>{item.label}</TabsTrigger>)}
      </TabsList>}
      {toolbar && <div className="view-tabs-actions ml-auto flex items-center gap-2">{toolbar}</div>}
    </div>
    {children}
  </Tabs>
}

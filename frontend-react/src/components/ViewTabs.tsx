import type { ComponentProps, ReactNode } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

type ViewTabsProps = Pick<ComponentProps<typeof Tabs>, 'value' | 'defaultValue' | 'onValueChange' | 'className'> & {
  variant?: 'line' | 'button'
  label: string
  items: { value: string; label: ReactNode }[]
  toolbar?: ReactNode
  children: ReactNode
}

// 본문 보기와 결과 뷰어가 공유하는 보기 탭입니다. 콘텐츠는 TabsContent로 조합합니다.
export function ViewTabs({ variant = 'line', label, items, toolbar, children, ...props }: ViewTabsProps) {
  return <Tabs {...props}>
    <div className="view-tabs-heading flex shrink-0 flex-wrap items-center gap-2">
      {items.length > 0 && <TabsList className={variant === 'button' ? 'view-tabs-list gap-2 bg-muted' : 'view-tabs-list gap-2 bg-transparent'} variant={variant === 'button' ? 'default' : 'line'} aria-label={label}>
        {items.map((item) => <TabsTrigger className={variant === 'button' ? 'view-tabs-trigger data-active:border-transparent! data-active:bg-primary! data-active:text-primary-foreground! data-active:shadow-none!' : 'view-tabs-trigger'} key={item.value} value={item.value}>{item.label}</TabsTrigger>)}
      </TabsList>}
      {toolbar && <div className="view-tabs-actions ml-auto flex items-center gap-2">{toolbar}</div>}
    </div>
    {children}
  </Tabs>
}

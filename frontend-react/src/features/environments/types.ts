import type { RequestField } from '@/features/workspace/types'

export type Environment = {
  id: string
  name: string
  variables: RequestField[]
}

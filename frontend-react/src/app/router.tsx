import { createBrowserRouter, Navigate } from 'react-router'
import { WorkspacePage } from '@/pages/workspace/WorkspacePage'

export const router = createBrowserRouter([
  { path: '/', element: <WorkspacePage /> },
  { path: '*', element: <Navigate to="/" replace /> },
])

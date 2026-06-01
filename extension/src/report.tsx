import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import ReportTab from './pages/ReportTab'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ReportTab />
  </StrictMode>
)

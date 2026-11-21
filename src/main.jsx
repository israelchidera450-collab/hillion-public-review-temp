import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ClassroomErrorBoundary from './components/ClassroomErrorBoundary'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ClassroomErrorBoundary>
      <App />
    </ClassroomErrorBoundary>
  </StrictMode>,
)

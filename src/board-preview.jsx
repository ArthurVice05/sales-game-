import React from 'react'
import { createRoot } from 'react-dom/client'

import LandscapeBoardPreview from './components/board/LandscapeBoardPreview.jsx'

const container = document.getElementById('board-preview-root')

if (!container) {
  throw new Error('Board preview root element was not found')
}

if (!import.meta.env.DEV) {
  container.textContent = 'Prévia visual disponível somente em desenvolvimento.'
} else {
  createRoot(container).render(
    <React.StrictMode>
      <LandscapeBoardPreview />
    </React.StrictMode>,
  )
}

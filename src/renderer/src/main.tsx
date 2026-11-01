// Configure Monaco workers BEFORE any editor/model is created.
import './monaco/worker'
import './styles.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found')

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

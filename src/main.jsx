import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// index.html's static title/description are for scrapers that don't run JS.
// Each route renders its own via PageMeta, which React 19 hoists into <head>
// without replacing these — drop them so there's only ever one of each.
document.querySelectorAll('head > title, head > meta[name="description"]').forEach(n => n.remove())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

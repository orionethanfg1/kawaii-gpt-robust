import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import '@fontsource/nunito/400.css'
import '@fontsource/nunito/600.css'
import '@fontsource/nunito/700.css'
import App from './app/App'

const rootEl = document.getElementById('root')

function showBootError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  const stack = err instanceof Error ? err.stack ?? '' : ''
  console.error('[boot]', err)
  if (!rootEl) return
  rootEl.innerHTML = `
    <div style="font-family:system-ui,sans-serif;padding:24px;max-width:560px;margin:40px auto;background:#FFF8F0;color:#4A3F3A;">
      <h1 style="font-size:1.25rem;">KawaiiGPT no pudo iniciar</h1>
      <p style="color:#666;font-size:14px;">Revisa la terminal de <code>npm run dev</code>.</p>
      <pre style="background:#fde8ef;padding:12px;border-radius:8px;overflow:auto;font-size:12px;color:#9f1239;">${message.replace(/</g,'&lt;')}</pre>
      <pre style="background:#f5f5f5;padding:12px;border-radius:8px;overflow:auto;font-size:10px;max-height:200px;">${stack.replace(/</g,'&lt;')}</pre>
      <button style="margin-top:12px;padding:8px 16px;border-radius:8px;border:none;background:#db2777;color:#fff;cursor:pointer"
        onclick="location.reload()">Recargar</button>
    </div>
  `
}

try {
  if (!rootEl) throw new Error('#root no encontrado')
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
} catch (err) {
  showBootError(err)
}

window.addEventListener('unhandledrejection', (ev) => {
  console.error('[unhandledrejection]', ev.reason)
})
window.addEventListener('error', (ev) => {
  console.error('[window.error]', ev.error || ev.message)
})

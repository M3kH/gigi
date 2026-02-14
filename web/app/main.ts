/**
 * Vite SPA entry point.
 * This will be the new typed frontend for Gigi.
 */

const app = document.getElementById('app')

if (app) {
  app.innerHTML = `
    <h1>Gigi</h1>
    <p>App shell loaded.</p>
    <p id="health-status">Checking health...</p>
  `

  fetch('/health')
    .then(res => res.json())
    .then(data => {
      const el = document.getElementById('health-status')
      if (el) {
        el.textContent = data.ok ? 'Backend: healthy' : 'Backend: degraded'
      }
    })
    .catch(() => {
      const el = document.getElementById('health-status')
      if (el) {
        el.textContent = 'Backend: unreachable'
      }
    })
}

/**
 * Vite SPA entry point — Svelte 5 + Shoelace
 *
 * Boots the Gigi frontend app shell.
 */

import './styles/theme.css'

// Shoelace: register light/dark themes + base styles
import '@shoelace-style/shoelace/dist/themes/dark.css'
import '@shoelace-style/shoelace/dist/themes/light.css'

// highlight.js dark theme for code blocks
import 'highlight.js/styles/github-dark.css'

// Set Shoelace asset base path for icons etc.
import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js'
setBasePath('/shoelace')

import { mount } from 'svelte'
import App from './App.svelte'

const target = document.getElementById('app')

if (target) {
  mount(App, { target })
}

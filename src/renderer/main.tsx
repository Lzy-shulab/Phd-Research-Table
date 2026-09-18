import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './app/App'
import './styles/globals.css'
import './styles/research.css'
import './styles/settings.css'
import './styles/evolution.css'
import './styles/submissions.css'
import './styles/interface.css'
import './styles/assistant.css'
import './styles/paper-studio.css'
import './styles/atelier.css'
import { MotionConfig } from 'motion/react'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MotionConfig
      reducedMotion="user"
      transition={{ type: 'tween', duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      <App />
    </MotionConfig>
  </React.StrictMode>
)

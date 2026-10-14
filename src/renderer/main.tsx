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
import './styles/planner-refresh.css'
import './styles/task-overview.css'
import './styles/hierarchy.css'
import './styles/refinement.css'
import './styles/reports.css'
import './styles/workspace-rhythm.css'
import './styles/experience.css'
import './styles/glass-upgrade.css'
import './styles/motion-craft.css'
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

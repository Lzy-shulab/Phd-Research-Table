import { useEffect, useState } from 'react'
import { localDay } from '../../shared/arxiv'
import { localEncouragement, millisecondsToMidnight } from '../../shared/encouragement'

export function useEncouragement() {
  const [value, setValue] = useState(() => localEncouragement())
  const [busy, setBusy] = useState(true)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let stopped = false, working = false, displayedDate = '', online = false
    let midnight: ReturnType<typeof setTimeout>
    const update = async (force = false) => {
      if (working || stopped) return
      working = true; setBusy(true)
      try {
        let result = await window.workbench.dailyEncouragement(force)
        if (result.ok && result.data.date !== localDay()) result = await window.workbench.dailyEncouragement()
        if (!stopped && result.ok) { displayedDate = result.data.date; online = result.data.state === 'online'; setValue(result.data) }
      } catch { /* Keep the displayed sentence; the next wake or online event retries. */ }
      finally { working = false; if (!stopped) setBusy(false) }
    }
    const catchUp = () => { void update() }
    const schedule = () => {
      midnight = setTimeout(() => { catchUp(); schedule() }, millisecondsToMidnight(new Date()) + 30)
    }
    void update(retry > 0); schedule()
    // Handles system clock changes and resumes where Chromium delayed the midnight timer.
    const watchdog = setInterval(() => { if (displayedDate !== localDay() || !online) catchUp() }, 60_000)
    const unsubscribe = window.workbench.onEncouragementChanged(catchUp)
    window.addEventListener('focus', catchUp)
    window.addEventListener('online', catchUp)
    document.addEventListener('visibilitychange', catchUp)
    return () => { stopped = true; unsubscribe(); clearTimeout(midnight); clearInterval(watchdog); window.removeEventListener('focus', catchUp); window.removeEventListener('online', catchUp); document.removeEventListener('visibilitychange', catchUp) }
  }, [retry])
  return { value, busy, retry: () => setRetry((count) => count + 1) }
}

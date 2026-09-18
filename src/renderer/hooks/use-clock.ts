import { useEffect, useState } from 'react'
export function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const update = () => setNow(new Date())
    const timer = setInterval(update, 30000)
    window.addEventListener('focus', update)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', update)
    }
  }, [])
  return now
}

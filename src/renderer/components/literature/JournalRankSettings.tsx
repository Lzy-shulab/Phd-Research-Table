import { useState } from 'react'
import { Button } from '../ui/button'
import { libraryAction, useLibrary } from '../../stores/library'

export function JournalRankSettings() {
  const ranks = useLibrary(state => state.journalRanks)
  const [secretKey, setSecretKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const save = async (clearKey = false) => {
    setBusy(true)
    try {
      const result = await libraryAction(window.workbench.saveJournalRankSettings({ secretKey: clearKey ? undefined : secretKey, enabled: ranks?.enabled ?? true, clearKey }))
      if (result) { setSecretKey(''); setMessage(clearKey ? 'Secret Key 已清除' : '已保存') }
    } finally { setBusy(false) }
  }
  return <section className="journal-rank-settings" aria-label="easyScholar 期刊分区设置">
    <div className="journal-rank-heading"><h3>easyScholar 期刊分区</h3><label><input type="checkbox" role="switch" aria-label="显示期刊分区" checked={ranks?.enabled ?? true}
      onChange={event => void libraryAction(window.workbench.saveJournalRankSettings({ enabled: event.target.checked }))} />显示分区</label></div>
    <label className="field">easyScholar Secret Key<input type="password" autoComplete="new-password" value={secretKey} maxLength={10000}
      placeholder={ranks?.configured ? '已保存；留空保留现有密钥' : '填写个人 Secret Key'} onChange={event => setSecretKey(event.target.value)} /></label>
    <div className="journal-rank-actions"><Button variant="ghost" onClick={() => void window.workbench.openJournalRankConsole()}>获取 Secret Key</Button>
      {ranks?.configured && <Button variant="ghost" disabled={busy} onClick={() => void save(true)}>清除密钥</Button>}
      <Button disabled={busy || !secretKey.trim()} onClick={() => void save()}>保存密钥</Button>
      <Button disabled={busy || !ranks?.configured || !ranks.enabled || ranks.refreshing} onClick={async () => {
        setBusy(true); setMessage('')
        try { await libraryAction(window.workbench.refreshJournalRanks(useLibrary.getState().papers.map(paper => paper.journal), true)) }
        finally { setBusy(false) }
      }}>{ranks?.refreshing ? '正在查询…' : '刷新分区'}</Button></div>
    {(ranks?.error || message) && <p role={ranks?.error ? 'alert' : 'status'} className={ranks?.error ? 'field-error' : 'field-hint'}>{ranks?.error || message}</p>}
  </section>
}

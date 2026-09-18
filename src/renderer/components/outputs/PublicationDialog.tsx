import { useEffect, useRef, useState } from 'react'
import { FileText, RefreshCw, ScanText, Trash2, Upload } from 'lucide-react'
import { journalPartitions, type Paper, type PublicationInput, type PublicationMetadataPreview } from '../../../shared/types'
import { publicationSchema } from '../../../domain/research'
import { mergePublicationMetadata, publicationMetadataKeys } from '../../../domain/publication-metadata'
import { useLibrary, libraryAction } from '../../stores/library'
import { openPdf, openPdfBytes } from '../../lib/pdf'
import { readPdfMetadata } from '../../lib/metadata'
import { Button } from '../ui/button'
import { ConfirmDialog, Dialog } from '../ui/dialog'
import { publicationHonorDetails } from './publication-honors'

export function PublicationDialog({ paper, onClose }: { paper?: Paper; onClose: () => void }) {
  const [draft, setDraft] = useState<PublicationInput>({ title: paper?.title ?? '', authors: paper?.authors ?? '', journal: paper?.journal ?? '',
    publishedDate: paper?.publishedDate ?? '', doi: paper?.doi ?? '', casPartition: paper?.casPartition ?? '', jcrQuartile: paper?.jcrQuartile ?? '', honors: paper?.honors ?? [], notes: paper?.notes ?? '' })
  const [path, setPath] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [remove, setRemove] = useState(false)
  const [identifying, setIdentifying] = useState(false)
  const [phase, setPhase] = useState('')
  const [identified, setIdentified] = useState<Pick<PublicationMetadataPreview, 'source' | 'message' | 'status'> | null>(null)
  const [datePrecision, setDatePrecision] = useState(() => paper?.publishedDate.length === 4 ? 'year' : paper?.publishedDate.length === 7 ? 'month' : 'day')
  const metadataOnline = useLibrary((state) => state.metadataOnline)
  const metadataAutomatic = useLibrary((state) => state.metadataAutomatic)
  const generation = useRef(0)
  const initialPaper = useRef(paper)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const touched = useRef<Set<keyof PublicationInput>>(new Set(paper ? publicationMetadataKeys.filter((key) => !!paper[key]) : []))
  useEffect(() => {
    const requestGeneration = generation
    if (initialPaper.current) {
      try { for (const key of JSON.parse(initialPaper.current.metadataLockedFields) as string[]) if (publicationMetadataKeys.some((field) => field === key)) touched.current.add(key as keyof PublicationInput) }
      catch { /* Older records may not have explicit metadata locks. */ }
    }
    return () => { requestGeneration.current++ }
  }, [])
  useEffect(() => {
    if ([4, 7, 10].includes(draft.publishedDate.length)) setDatePrecision(draft.publishedDate.length === 4 ? 'year' : draft.publishedDate.length === 7 ? 'month' : 'day')
  }, [draft.publishedDate])
  const shownPrecision = [4, 7, 10].includes(draft.publishedDate.length) ? draft.publishedDate.length === 4 ? 'year' : draft.publishedDate.length === 7 ? 'month' : 'day' : datePrecision
  const update = (key: keyof PublicationInput, value: string) => {
    touched.current.add(key)
    setDraft((previous) => ({ ...previous, [key]: value }))
  }
  const identify = async (selected = path) => {
    const request = ++generation.current
    setIdentifying(true); setIdentified(null); setPhase('正在读取 PDF 资料…')
    try {
      let document
      if (paper) document = await openPdf(paper.id, 'source')
      else {
        const bytes = await window.workbench.readPublicationPdf(selected)
        if (!bytes.ok) throw new Error(bytes.error.message)
        document = await openPdfBytes(bytes.data)
      }
      const local = await readPdfMetadata(document, paper?.originalName ?? selected.split(/[\\/]/).pop() ?? '')
      if (generation.current !== request) return
      setDraft((previous) => mergePublicationMetadata(previous, { ...local, publishedDate: local.publishedDate || local.year }, touched.current))
      setPhase(metadataOnline ? '正在联网补全发表信息…' : '正在整理 PDF 资料…')
      const result = await window.workbench.previewPublicationMetadata(local, {
        title: touched.current.has('title') ? draftRef.current.title : '',
        doi: touched.current.has('doi') ? draftRef.current.doi : ''
      })
      if (generation.current !== request) return
      if (!result.ok) throw new Error(result.error.message)
      setDraft((previous) => mergePublicationMetadata(previous, result.data.fields, touched.current))
      setIdentified(result.data)
    } catch (error) {
      if (generation.current === request) setIdentified({ status: 'partial', source: '资料待补充', message: `${error instanceof Error ? error.message : 'PDF 资料未能读取。'} 可以手动填写后保存，或重新识别。` })
    } finally { if (generation.current === request) setIdentifying(false) }
  }
  const pick = async () => {
    setBusy(true); setError('')
    try {
      const result = await window.workbench.pickPublicationPdf()
      if (!result.ok) { setError(result.error.message); return }
      if (!result.data) return
      generation.current++; setIdentifying(false); setIdentified(null)
      setPath(result.data)
      const filename = (result.data.split(/[\\/]/).pop() ?? '').replace(/\.pdf$/i, '')
      setDraft((previous) => {
        const next = { ...previous }
        for (const key of publicationMetadataKeys) if (!touched.current.has(key)) next[key] = key === 'title' ? filename : ''
        return next
      })
      if (metadataAutomatic) void identify(result.data)
    } catch { setError('无法选择 PDF，请重试。') } finally { setBusy(false) }
  }
  return <>
    <Dialog open className="publication-dialog" title={paper ? '编辑科研成果' : '添加已发表成果'} description="选中 PDF 后自动识别文章资料，核对发表信息后保存。"
      onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <form className="project-form" onSubmit={async (event) => {
        event.preventDefault(); if (busy || identifying) return
        const parsed = publicationSchema.safeParse(draft)
        if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '请检查发表信息。'); return }
        if (!paper && !path) { setError('请先选择成果 PDF。'); return }
        setBusy(true); setError('')
        try {
          const result = paper ? await window.workbench.updatePaper(paper.id, parsed.data) : await window.workbench.createPublication(path, parsed.data)
          if (!result.ok) { setError(result.error.message); return }
          await useLibrary.getState().load()
          if (!paper) useLibrary.getState().filterOutputs('all', 'all')
          onClose()
        } catch { setError('成果未能保存，请检查文件后重试。') } finally { setBusy(false) }
      }}>
        <div className="publication-pdf-input"><FileText size={24} /><span><strong>{paper ? paper.originalName : path ? path.split(/[\\/]/).pop() : '选择已发表论文的 PDF'}</strong><small>原文件保留 · 副本保存在本机</small></span>
          {!paper && <Button onClick={() => void pick()} disabled={busy}><Upload size={14} />{path ? '重新选择' : '选择 PDF'}</Button>}</div>
        {(paper || path) && <div className={`publication-recognition ${identified?.status === 'partial' ? 'is-partial' : ''}`} role="status" aria-live="polite">
          <div>{identifying ? <span className="tiny-spinner" /> : <ScanText size={16} />}<span><strong>{identifying ? phase : identified ? identified.source : '文章资料自动识别'}</strong>
            <small>{identifying ? '可继续核对或修改字段，你的修改会保留。' : identified?.message || (metadataOnline ? '使用 PDF 及公开书目补全缺失信息，不上传 PDF 全文。' : '联网补全已关闭，将只读取 PDF 资料。')}</small></span></div>
          {identifying ? <Button variant="ghost" onClick={() => { generation.current++; setIdentifying(false); setIdentified({ status: 'partial', source: '手动填写', message: '已结束等待，保留已读取的资料。' }) }}>手动填写</Button>
            : <Button variant="ghost" disabled={busy} onClick={() => void identify()}><RefreshCw size={13} />{identified || paper ? '重新识别' : '识别资料'}</Button>}
        </div>}
        <label className="field">成果标题<textarea aria-label="成果标题" rows={2} maxLength={1000} required value={draft.title} onChange={(e) => update('title', e.target.value)} /></label>
        <label className="field">作者<input required maxLength={2000} placeholder="按论文顺序填写作者" value={draft.authors} onChange={(e) => update('authors', e.target.value)} /></label>
        <div className="field-pair"><label className="field">期刊 / 会议<input required maxLength={500} placeholder="例如 IEEE TGRS" value={draft.journal} onChange={(e) => update('journal', e.target.value)} /></label>
          <div className="field"><label htmlFor="publication-date">发表时间</label><div className="publication-date-input"><select aria-label="发表时间精度" value={shownPrecision} onChange={(event) => {
            const precision = event.target.value, length = precision === 'year' ? 4 : precision === 'month' ? 7 : 10
            setDatePrecision(precision); update('publishedDate', draft.publishedDate.length >= length ? draft.publishedDate.slice(0, length) : '')
          }}><option value="day">完整日期</option><option value="month">仅年月</option><option value="year">仅年份</option></select>
            <input id="publication-date" aria-label="发表时间" type={shownPrecision === 'year' ? 'text' : shownPrecision === 'month' ? 'month' : 'date'} inputMode={shownPrecision === 'year' ? 'numeric' : undefined} maxLength={shownPrecision === 'year' ? 4 : undefined} placeholder="例如 2024" required value={draft.publishedDate} onChange={(e) => update('publishedDate', e.target.value)} /></div></div></div>
        <p className="field-hint publication-date-hint">只有年份或月份时，可按实际精度保存，无需补填具体月日。</p>
        <div className="field-pair"><label className="field">期刊分区<select aria-label="期刊分区" value={draft.casPartition} onChange={(e) => update('casPartition', e.target.value)}><option value="">暂未填写</option>{journalPartitions.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="field">JCR 分区<select aria-label="JCR 分区" value={draft.jcrQuartile} onChange={(e) => update('jcrQuartile', e.target.value)}><option value="">暂未填写</option>{['Q1', 'Q2', 'Q3', 'Q4', '非SCI'].map((value) => <option key={value}>{value}</option>)}</select></label></div>
        <fieldset className="publication-honors-field"><legend>论文荣誉 <span>可多选</span></legend>
          <div className="publication-honor-options" role="group" aria-label="论文荣誉">{publicationHonorDetails.map(({ id, label, icon: Icon }) => {
            const selected = draft.honors.includes(id)
            return <button key={id} type="button" data-honor={id} aria-pressed={selected} onClick={() => setDraft((previous) => ({
              ...previous, honors: selected ? previous.honors.filter((honor) => honor !== id) : [...previous.honors, id]
            }))}><Icon size={15} />{label}</button>
          })}</div>
          <p className="field-hint">荣誉信息由你确认，不根据期刊或引用数据自动推断。</p>
        </fieldset>
        <label className="field">DOI<input maxLength={500} placeholder="10.xxxx/… 或 DOI 链接，可留空" value={draft.doi} onChange={(e) => update('doi', e.target.value)} /></label>
        <label className="field">成果备注<textarea aria-label="成果备注" rows={2} maxLength={50000} placeholder="可记录分区年份、作者贡献或研究亮点" value={draft.notes} onChange={(e) => update('notes', e.target.value)} /></label>
        {error && <p role="alert" className="field-error">{error}</p>}
        <div className="dialog-actions">{paper && <Button variant="ghost" className="danger-text push-right" disabled={busy} onClick={() => setRemove(true)}><Trash2 size={15} />移除成果</Button>}
          <Button onClick={onClose} disabled={busy}>取消</Button><Button variant="primary" type="submit" disabled={busy || identifying}>{busy ? '保存中…' : identifying ? '识别中…' : '保存成果'}</Button></div>
      </form>
    </Dialog>
    {paper && <ConfirmDialog open={remove} title="移除这项成果？" description="成果信息将移除，托管 PDF 副本会进入回收站；上传前的原始文件保留。" busy={busy} onClose={() => setRemove(false)} onConfirm={async () => {
      setBusy(true)
      try { const result = await window.workbench.deletePaper(paper.id); await libraryAction(Promise.resolve(result)); if (result.ok) onClose() }
      finally { setBusy(false) }
    }} />}
  </>
}

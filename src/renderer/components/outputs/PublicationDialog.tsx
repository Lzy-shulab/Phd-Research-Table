import { useEffect, useRef, useState } from 'react'
import { FileText, RefreshCw, ScanText, Trash2, Upload } from 'lucide-react'
import { journalPartitions, type Paper, type PublicationInput, type PublicationMetadataPreview } from '../../../shared/types'
import { publicationSchema } from '../../../domain/research'
import { mergePublicationMetadata, publicationMetadataKeys } from '../../../domain/publication-metadata'
import { useLibrary, libraryAction } from '../../stores/library'
import { useWorkbench } from '../../stores/workbench'
import { openPdf, openPdfBytes } from '../../lib/pdf'
import { readPdfMetadata } from '../../lib/metadata'
import { Button } from '../ui/button'
import { ConfirmDialog, Dialog } from '../ui/dialog'
import { publicationHonorDetails } from './publication-honors'
import { clearDraft, readDraft, writeDraft } from '../../lib/drafts'
import { DraftCloseDialog } from '../ui/DraftCloseDialog'

export function PublicationDialog({ paper, seed, sourceSubmissionId, onClose }: { paper?: Paper; seed?: Partial<PublicationInput>; sourceSubmissionId?: string; onClose: () => void }) {
  const draftKey = `publication.${paper?.id ?? 'new'}`
  const initialDraft = useRef<PublicationInput>({ title: paper?.title ?? seed?.title ?? '', authors: paper?.authors ?? seed?.authors ?? '', journal: paper?.journal ?? seed?.journal ?? '',
    publishedDate: paper?.publishedDate ?? seed?.publishedDate ?? '', doi: paper?.doi ?? seed?.doi ?? '', casPartition: paper?.casPartition ?? seed?.casPartition ?? '', jcrQuartile: paper?.jcrQuartile ?? seed?.jcrQuartile ?? '', honors: paper?.honors ?? seed?.honors ?? [], notes: paper?.notes ?? seed?.notes ?? '',
    authorRole: paper?.authorRole ?? '', coFirstAuthor: paper?.coFirstAuthor ?? false, correspondingAuthor: paper?.correspondingAuthor ?? false,
    partitionYear: paper?.partitionYear ?? '', tags: paper?.tags ?? [] })
  const [draft, setDraft] = useState<PublicationInput>(() => readDraft<PublicationInput>(draftKey)?.value ?? initialDraft.current)
  const [path, setPath] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [remove, setRemove] = useState(false)
  const [identifying, setIdentifying] = useState(false)
  const [phase, setPhase] = useState('')
  const [closePrompt, setClosePrompt] = useState(false)
  const [identified, setIdentified] = useState<Pick<PublicationMetadataPreview, 'source' | 'message' | 'status'> | null>(null)
  const [datePrecision, setDatePrecision] = useState(() => paper?.publishedDate.length === 4 ? 'year' : paper?.publishedDate.length === 7 ? 'month' : 'day')
  const metadataOnline = useLibrary((state) => state.metadataOnline)
  const metadataAutomatic = useLibrary((state) => state.metadataAutomatic)
  const generation = useRef(0)
  const initialPaper = useRef(paper)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft.current) || !!path
  useEffect(() => { if (dirty) writeDraft(draftKey, draft) }, [draft, draftKey, dirty])
  const requestClose = () => { if (busy || identifying) return; if (dirty) setClosePrompt(true); else onClose() }
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
      if (paper && !paper.sourcePath) {
        const attached = await window.workbench.attachPublicationPdf(paper.id, result.data)
        if (!attached.ok) { setError(attached.error.message); return }
        await useLibrary.getState().load()
        setError(''); setPath('');
        useWorkbench.getState().notify('PDF 已补充到原成果记录。', 'info')
        return
      }
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
    <Dialog open className="publication-dialog" title={paper ? '编辑科研成果' : '添加已发表成果'} description="可先填写 DOI 或发表信息，PDF 可以现在选择，也可以保存后再补充。"
      onOpenChange={(open) => { if (!open) requestClose() }}>
      <form className="project-form" onSubmit={async (event) => {
        event.preventDefault(); if (busy || identifying) return
        const parsed = publicationSchema.safeParse(draft)
        if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '请检查发表信息。'); return }
        setBusy(true); setError('')
        try {
          const result = paper ? await window.workbench.updatePaper(paper.id, parsed.data) : await window.workbench.createPublication(path || null, parsed.data)
          if (!result.ok) { setError(result.error.message); return }
          if (!paper && sourceSubmissionId) await window.workbench.updatePaper(result.data.id, { linkedSubmissionId: sourceSubmissionId })
          await useLibrary.getState().load()
          if (!paper) useLibrary.getState().filterOutputs('all', 'all')
          clearDraft(draftKey)
          onClose()
        } catch { setError('成果未能保存，请检查文件后重试。') } finally { setBusy(false) }
      }}>
        <div className="publication-pdf-input"><FileText size={24} /><span><strong>{paper?.originalName || (path ? path.split(/[\\/]/).pop() : '尚未关联 PDF')}</strong><small>{paper?.sourcePath || path ? '原文件保留 · 副本保存在本机' : '可以只保存成果信息，稍后补充 PDF'}</small></span>
          {(!paper || !paper.sourcePath) && <Button onClick={() => void pick()} disabled={busy}><Upload size={14} />{paper ? '补充 PDF' : path ? '重新选择' : '选择 PDF（可选）'}</Button>}</div>
        {((paper?.sourcePath) || path) && <div className={`publication-recognition ${identified?.status === 'partial' ? 'is-partial' : ''}`} role="status" aria-live="polite">
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
        <div className="field-pair"><label className="field">分区年份<input inputMode="numeric" maxLength={4} placeholder="例如 2026" value={draft.partitionYear ?? ''} onChange={(e) => setDraft((current) => ({ ...current, partitionYear: e.target.value }))} /></label>
          <label className="field">作者身份<input maxLength={200} placeholder="例如 第一作者、导师通讯" value={draft.authorRole ?? ''} onChange={(e) => setDraft((current) => ({ ...current, authorRole: e.target.value }))} /></label></div>
        <div className="publication-author-flags"><label><input type="checkbox" checked={draft.coFirstAuthor ?? false} onChange={(e) => setDraft((current) => ({ ...current, coFirstAuthor: e.target.checked }))} />共同一作</label><label><input type="checkbox" checked={draft.correspondingAuthor ?? false} onChange={(e) => setDraft((current) => ({ ...current, correspondingAuthor: e.target.checked }))} />通讯作者</label></div>
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
        <label className="field">主题标签<input maxLength={1000} placeholder="多个标签用逗号分隔" value={(draft.tags ?? []).join(', ')} onChange={(e) => setDraft((current) => ({ ...current, tags: e.target.value.split(/[,，]/).map((value) => value.trim()).filter(Boolean).slice(0, 30) }))} /></label>
        <label className="field">成果备注<textarea aria-label="成果备注" rows={2} maxLength={50000} placeholder="可记录分区年份、作者贡献或研究亮点" value={draft.notes} onChange={(e) => update('notes', e.target.value)} /></label>
        {error && <p role="alert" className="field-error">{error}</p>}
        <div className="dialog-actions">{paper && <Button variant="ghost" className="danger-text push-right" disabled={busy} onClick={() => setRemove(true)}><Trash2 size={15} />移除成果</Button>}
          <Button onClick={requestClose} disabled={busy}>取消</Button><Button variant="primary" type="submit" disabled={busy || identifying}>{busy ? '保存中…' : identifying ? '识别中…' : '保存成果'}</Button></div>
      </form>
    </Dialog>
    <DraftCloseDialog open={closePrompt} onContinue={() => setClosePrompt(false)} onKeep={() => { writeDraft(draftKey, draft); setClosePrompt(false); onClose() }} onDiscard={() => { clearDraft(draftKey); setClosePrompt(false); onClose() }} />
    {paper && <ConfirmDialog open={remove} title="移除这项成果？" description="成果信息将移除，托管 PDF 副本会进入回收站；上传前的原始文件保留。" busy={busy} onClose={() => setRemove(false)} onConfirm={async () => {
      setBusy(true)
      try { const result = await window.workbench.deletePaper(paper.id); await libraryAction(Promise.resolve(result)); if (result.ok) onClose() }
      finally { setBusy(false) }
    }} />}
  </>
}

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Award, BookOpen, Pencil, X } from 'lucide-react'
import type { Paper } from '../../../shared/types'
import { useLibrary } from '../../stores/library'
import { PdfCover } from '../literature/PdfCover'
import { Button } from '../ui/button'
import { publicationHonorDetails } from './publication-honors'

function binding(id: string) {
  let value = 0
  for (const char of id) value = (value * 31 + char.charCodeAt(0)) >>> 0
  return { tone: value % 8, height: 242 + (value % 6) * 13, width: 64 + (value % 3) * 7 }
}

export function PublicationBookcase({ papers, edit }: { papers: Paper[]; edit: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const handingOff = useRef(false)
  const [perShelf, setPerShelf] = useState(10)
  const [selection, setSelection] = useState<{ id: string; x: number; y: number } | null>(null)
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const reduced = useReducedMotion()
  const paper = papers.find((item) => item.id === selection?.id)
  useEffect(() => {
    const element = host.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setPerShelf(Math.max(1, Math.floor((entry.contentRect.width - 56) / 86)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const rows = Array.from({ length: Math.ceil(papers.length / perShelf) }, (_, index) => papers.slice(index * perShelf, (index + 1) * perShelf))
  const closeFor = (action: () => void) => { handingOff.current = true; setOpen(false); action() }
  const pose = reduced ? { opacity: 0 } : {
    opacity: 0, scale: 0.2, x: (selection?.x ?? innerWidth / 2) - innerWidth / 2,
    y: (selection?.y ?? innerHeight / 2) - innerHeight / 2, rotateY: -65
  }
  return <div className="publication-bookcase" ref={host} aria-label="科研成果书架">
    {rows.map((row, shelf) => <section className="book-shelf" key={shelf} aria-label={`第 ${shelf + 1} 层书架`}>
      <div className="book-shelf-books">{row.map((item) => {
        const design = binding(item.id)
        return <motion.button key={item.id} type="button" className={`publication-book book-tone-${design.tone}`}
          data-testid="publication-book" aria-label={`抽出论文 ${item.title}`} aria-haspopup="dialog" title={`${item.title}\n${item.authors}\n${item.journal} · ${item.publishedDate}`}
          style={{ '--book-height': `${design.height}px`, '--book-width': `${design.width}px` } as CSSProperties}
          animate={reduced ? { y: 0, rotate: 0, opacity: 1 } : open && selection?.id === item.id ? { y: -28, rotate: -5, opacity: 0.3 } : { y: hovered === item.id && !open ? -10 : 0, rotate: 0, opacity: 1 }}
          onPointerEnter={() => { if (!open) setHovered(item.id) }} onPointerLeave={() => setHovered(null)}
          transition={{ type: 'tween', duration: reduced ? 0 : 0.23, ease: 'easeOut' }}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect()
            trigger.current = event.currentTarget; handingOff.current = false; setHovered(null)
            setSelection({ id: item.id, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }); setOpen(true)
          }}>
          <span className="book-spine-year">{item.publishedDate.slice(0, 4) || item.year || '—'}</span>
          <span className="book-spine-rule" aria-hidden="true" />
          <span className="book-spine-title">{item.title}</span>
          <span className="book-spine-author">{item.authors || '作者待补充'}</span>
          <span className="book-spine-mark" aria-hidden="true">{item.honors.length ? <Award size={16} /> : <span />}</span>
        </motion.button>
      })}</div>
      <div className="book-shelf-ledge" aria-hidden="true" />
      <div className="book-shelf-caption"><span>{String(shelf + 1).padStart(2, '0')} / 我的藏书</span><span>{row.length} 篇</span></div>
    </section>)}
    <Dialog.Root open={open && !!paper} onOpenChange={(value) => { setHovered(null); setOpen(value) }}>
      <AnimatePresence>
        {open && paper && <Dialog.Portal forceMount>
          <Dialog.Overlay forceMount asChild><motion.div className="book-detail-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0.1 : 0.2 }} /></Dialog.Overlay>
          <Dialog.Content forceMount asChild onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (!handingOff.current && trigger.current?.isConnected) trigger.current.focus({ preventScroll: true })
          }}>
            <motion.div className={`book-detail book-tone-${binding(paper.id).tone}`} data-testid="publication-detail"
              initial={pose} animate={{ opacity: 1, scale: 1, x: 0, y: 0, rotateY: 0 }}
              exit={{ ...pose, transition: { delay: reduced ? 0 : 0.18, duration: reduced ? 0.1 : 0.34 } }}
              transition={{ type: 'tween', duration: reduced ? 0.1 : 0.48, ease: [0.22, 1, 0.36, 1] }}>
              <div className="book-detail-preview">
                <span className="book-detail-edition">研究藏书 <span>{paper.publishedDate.slice(0, 4)}</span></span>
                <div className="book-title-page"><PdfCover key={paper.id} paper={paper} /></div>
                <span className="book-detail-preview-caption">论文标题页 <span>01</span></span>
              </div>
              <div className="book-detail-information">
                <div className="book-detail-scroll">
                  <Dialog.Description className="book-detail-eyebrow">发表记录 <span>PUBLICATION</span></Dialog.Description>
                  <Dialog.Title className="book-detail-title">{paper.title}</Dialog.Title>
                  <dl className="book-detail-metadata">
                    <div className="wide"><dt>作者</dt><dd>{paper.authors || '暂未填写'}</dd></div>
                    <div className="wide"><dt>期刊 / 会议</dt><dd>{paper.journal || '暂未填写'}</dd></div>
                    <div><dt>发表时间</dt><dd>{paper.publishedDate || paper.year || '暂未填写'}</dd></div>
                    <div><dt>期刊分区</dt><dd>{paper.casPartition || '暂未填写'}</dd></div>
                    <div><dt>JCR 分区</dt><dd>{paper.jcrQuartile || '暂未填写'}</dd></div>
                    <div className="wide"><dt>DOI</dt><dd className="book-detail-doi">{paper.doi || '暂未填写'}</dd></div>
                    <div className="wide"><dt>论文荣誉</dt><dd className="book-detail-honors">{paper.honors.length ? paper.honors.map((honor) => {
                      const detail = publicationHonorDetails.find((item) => item.id === honor)
                      if (!detail) return null
                      const Icon = detail.icon
                      return <span key={honor} className="publication-honor-badge" data-honor={honor}><Icon size={14} />{detail.label}</span>
                    }) : '暂未填写'}</dd></div>
                    {paper.notes && <div className="wide"><dt>成果备注</dt><dd className="book-detail-notes">{paper.notes}</dd></div>}
                  </dl>
                </div>
                <div className="book-detail-actions">
                  <Button variant="primary" onClick={() => closeFor(() => useLibrary.getState().openPaper(paper.id))}><BookOpen size={16} />阅读论文</Button>
                  <Button onClick={() => closeFor(() => edit(paper.id))}><Pencil size={15} />编辑发表信息</Button>
                </div>
                <span className="book-detail-page-number" aria-hidden="true">02</span>
              </div>
              {!reduced && <motion.div className="book-opening-cover" aria-hidden="true"
                initial={{ rotateY: 0, opacity: 1 }} animate={{ rotateY: -180, opacity: [1, 1, 0] }}
                exit={{ rotateY: 0, opacity: 1, transition: { duration: 0.2 } }}
                transition={{ rotateY: { delay: 0.18, duration: 0.65, ease: [0.33, 0, 0.2, 1] }, opacity: { delay: 0.18, duration: 0.65, times: [0, 0.92, 1] } }}>
                <span>研究藏书 / PUBLICATION</span><strong>{paper.title}</strong><span>{paper.journal} · {paper.publishedDate.slice(0, 4)}</span>
              </motion.div>}
              <Dialog.Close asChild><button className="book-detail-close" aria-label="放回书架"><X size={19} /></button></Dialog.Close>
            </motion.div>
          </Dialog.Content>
        </Dialog.Portal>}
      </AnimatePresence>
    </Dialog.Root>
  </div>
}

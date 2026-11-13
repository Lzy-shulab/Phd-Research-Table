import { gsap } from 'gsap'
import type { DesktopNotice } from '../../shared/widget'

const glyphs: Record<DesktopNotice['kind'], string> = {
  checkin: 'M16 6a10 10 0 1 0 0 20 10 10 0 1 0 0-20zm0 5v5l4 2',
  task: 'M8 8h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2zm3-3v6m10-6v6M6 14h20m-15 6 3 3 6-6',
  gpu: 'M9 9h14v14H9zm4 4h6v6h-6zm0-7v3m6-3v3m4 4h3m-3 6h3m-13 4v3m6-3v3M6 13h3m-3 6h3',
  cpolar: 'M7 8h18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2zm3 5 4 3-4 3m7 0h5'
}

export function mountRailNotice(anchor: HTMLButtonElement, updatePointer: () => void, showError: (result: { ok: boolean; error?: { message: string } }) => void) {
  const template = document.querySelector<HTMLTemplateElement>('#rail-notice-template')!
  const card = template.content.firstElementChild!.cloneNode(true) as HTMLElement
  const slot = anchor.parentElement!
  slot.prepend(card)
  const title = card.querySelector('strong')!, detail = card.querySelector('span')!, button = card.querySelector('button')!
  const glyph = card.querySelector('.rail-notice-glyph')!, check = card.querySelector('.rail-notice-check')!
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  let items: DesktopNotice[] = [], shown = '', busy = false

  const render = () => {
    if (busy) return
    const item = items[0]
    card.hidden = !item
    card.dataset.state = 'waiting'
    if (!item) { shown = ''; updatePointer(); return }
    card.dataset.kind = item.kind
    title.textContent = item.title
    detail.textContent = items.length > 1 ? `${item.detail} · +${items.length - 1}` : item.detail
    detail.title = detail.textContent
    glyph.setAttribute('d', glyphs[item.kind])
    button.textContent = item.kind === 'checkin' ? '去结束' : '知道了'
    button.setAttribute('aria-label', item.kind === 'checkin' ? '前往结束打卡' : `确认收到 ${item.title}`)
    if (shown !== item.id) {
      shown = item.id
      slot.scrollIntoView({ block: 'nearest' })
      if (!reduced.matches) gsap.fromTo(card, { x: 12, opacity: .5 }, { x: 0, opacity: 1, duration: .3, ease: 'power3.out', overwrite: true, clearProps: 'transform,opacity', onComplete: updatePointer })
    }
    updatePointer()
  }

  button.addEventListener('click', async event => {
    const item = items[0]
    if (!item || busy) return
    busy = true; button.disabled = true
    try {
      const result = await window.workbench.acknowledgeDesktopNotice(item.id)
      showError(result)
      if (!result.ok) { busy = false; button.disabled = false; render(); return }
      if (event.detail === 0) anchor.focus({ preventScroll: true })
      items = items.filter(pending => pending.id !== item.id)
      card.dataset.state = 'received'
      title.textContent = '已确认'
      detail.textContent = item.title
      const settle = () => { busy = false; button.disabled = false; render() }
      const finish = () => setTimeout(() => {
        if (reduced.matches) settle()
        else gsap.to(card, { x: 7, opacity: 0, duration: .14, ease: 'power2.in',
          overwrite: true, clearProps: 'transform,opacity', onComplete: settle })
      }, 500)
      if (reduced.matches) finish()
      else gsap.fromTo(check, { strokeDashoffset: 1, scale: .8 }, { strokeDashoffset: 0, scale: 1, duration: .35,
        ease: 'power2.out', transformOrigin: '50% 50%', clearProps: 'transform,strokeDashoffset', onComplete: finish })
    } catch { showError({ ok: false, error: { message: '提醒确认未保存，请重试。' } }); busy = false; button.disabled = false; render() }
  })
  return (next: DesktopNotice[]) => { items = next; render() }
}

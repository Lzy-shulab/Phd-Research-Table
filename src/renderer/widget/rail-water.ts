import { gsap } from 'gsap'

export function mountWaterReminder(
  checkin: HTMLButtonElement,
  launcher: HTMLButtonElement,
  updatePointer: () => void,
  showError: (result: { ok: boolean; error?: { message: string } }) => void
) {
  const template = document.querySelector<HTMLTemplateElement>('#rail-water-template')!
  const card = template.content.firstElementChild!.cloneNode(true) as HTMLElement
  const button = card.querySelector('button')!
  const title = card.querySelector('strong')!
  const detail = card.querySelector<HTMLElement>('.rail-water-copy span')!
  const glass = card.querySelector('.rail-water-glass')!
  const cup = card.querySelector('.rail-water-cup')!
  const water = card.querySelector('.rail-water-fill')!
  const check = card.querySelector('.rail-water-check')!
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  let dueAt: number | null = null
  let animation: gsap.core.Timeline | undefined
  let confirmedTimer: ReturnType<typeof setTimeout> | undefined
  let saving = false

  function render(nextDueAt: number | null) {
    const anchor = checkin.hidden ? launcher : checkin
    const slot = anchor.parentElement!
    if (card.parentElement !== slot) slot.prepend(card)
    const due = nextDueAt !== null && nextDueAt <= Date.now() ? nextDueAt : null
    if (saving || dueAt === due) return
    dueAt = due
    animation?.kill()
    clearTimeout(confirmedTimer)
    gsap.set([card, glass, cup, water, check], { clearProps: 'all' })
    card.hidden = due === null
    card.dataset.state = 'due'
    button.disabled = false
    title.textContent = '该喝水了'
    detail.hidden = true
    if (due !== null) {
      slot.scrollIntoView({ block: 'nearest' })
      if (!reduced.matches) {
        animation = gsap.timeline({ defaults: { ease: 'power3.out' }, onComplete: updatePointer })
          .from(card, { x: 12, opacity: .45, duration: .3 }, 0)
          .from(glass, { y: 5, rotation: -9, duration: .4 }, 0)
          .from(water, { y: 9, duration: .45 }, .04)
      }
    }
    updatePointer()
  }

  button.addEventListener('click', async event => {
    if (saving || dueAt === null) return
    const keyboard = event.detail === 0
    saving = true
    button.disabled = true
    try {
      const result = await window.workbench.updateWaterReminder('restart')
      if (!result.ok) { showError(result); button.disabled = false; return }
      showError(result)
      if (keyboard) (checkin.hidden ? launcher : checkin).focus({ preventScroll: true })
      card.dataset.state = 'drinking'
      title.textContent = '已喝水'
      detail.textContent = '30 分钟后再提醒'
      detail.hidden = false
      const complete = () => {
        card.dataset.state = 'done'
        confirmedTimer = setTimeout(() => render(result.data.waterReminderAt), 1800)
      }
      animation?.kill()
      gsap.set([card, glass, cup, water, check], { clearProps: 'all' })
      if (reduced.matches) complete()
      else {
        animation = gsap.timeline({ onComplete: complete })
          .to(cup, { rotation: -22, y: -4, transformOrigin: '50% 50%', duration: .25, ease: 'power2.inOut' }, 0)
          .to(water, { y: 21, duration: .3, ease: 'power2.in' }, .15)
          .to(cup, { opacity: 0, duration: .17 }, .42)
          .fromTo(check, { opacity: 0, scale: .65 }, { opacity: 1, scale: 1, transformOrigin: '50% 50%', duration: .24, ease: 'power3.out', clearProps: 'transform' }, .44)
      }
    } catch {
      showError({ ok: false, error: { message: '喝水记录未更新，请重试。' } })
      button.disabled = false
    } finally { saving = false }
  })

  return (nextDueAt: number | null) => {
    if (card.dataset.state === 'drinking' || card.dataset.state === 'done') return
    render(nextDueAt)
  }
}

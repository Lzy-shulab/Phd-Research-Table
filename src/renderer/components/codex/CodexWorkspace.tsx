import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as Select from '@radix-ui/react-select'
import { ArrowDown, ArrowUp, BookOpenText, Bot, Check, ChevronDown, CircleAlert, Clock3, Copy, ListTodo, RotateCcw, Square } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { codexReasoningEfforts, type CodexReasoningEffort } from '../../../shared/translation'
import { defaultWorkbenchModel, type WorkbenchCodexModel } from '../../../shared/workbench-codex'
import { useWorkbenchCodex, type AssistantTurn } from '../../stores/workbench-codex'
import { useInterface } from '../../stores/interface'
import { arrivalEase } from '../../lib/motion'
import { Button } from '../ui/button'
import { CodexNewChat } from './CodexNewChat'
import './codex-workspace.css'

const effortLabels: Record<CodexReasoningEffort, string> = {
  default: '模型默认', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高', ultra: '超高'
}
const starters = [
  { icon: Clock3, label: '查看昨天的打卡', prompt: '帮我查一下昨天的研究打卡，列出时间段和累计时长。' },
  { icon: ListTodo, label: '梳理今天的任务', prompt: '根据研究计划，列出今天尚未完成的任务，并标出优先级。' },
  { icon: BookOpenText, label: '查找文献笔记', prompt: '帮我查找与以下关键词相关的文献笔记：' }
]
const catalogFallback: WorkbenchCodexModel = { id: defaultWorkbenchModel, name: 'GPT-6.1 Terra', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] }
const timeFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const markdownPlugins = [remarkGfm]

function AssistantPicker({ label, value, options, disabled, onChange }: {
  label: string
  value: string
  options: { id: string; label: string }[]
  disabled: boolean
  onChange: (value: string) => void
}) {
  return <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
    <Select.Trigger className="codex-picker" aria-label={label}><Select.Value /><Select.Icon><ChevronDown size={13} /></Select.Icon></Select.Trigger>
    <Select.Portal><Select.Content className="select-content codex-picker-menu" position="popper" side="top" sideOffset={7} collisionPadding={12}>
      <Select.ScrollUpButton className="codex-picker-scroll"><ChevronDown size={14} /></Select.ScrollUpButton>
      <Select.Viewport>{options.map(option => <Select.Item key={option.id} className="codex-picker-option" value={option.id}>
        <Select.ItemText>{option.label}</Select.ItemText><Select.ItemIndicator><Check size={15} /></Select.ItemIndicator>
      </Select.Item>)}</Select.Viewport>
      <Select.ScrollDownButton className="codex-picker-scroll"><ChevronDown size={14} /></Select.ScrollDownButton>
    </Select.Content></Select.Portal>
  </Select.Root>
}

const Turn = memo(function Turn({ turn, restore }: { turn: AssistantTurn; restore: (text: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const timer = useRef<number>(0)
  const reduced = useReducedMotion()
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const completeText = turn.replies.filter(reply => reply.complete).map(reply => reply.text).join('\n\n')
  const copy = async () => {
    try {
      const result = await window.workbench.copyWorkbenchCodexReply(completeText)
      if (!result.ok) throw Error(result.error.message)
      window.clearTimeout(timer.current)
      setCopied(true)
      timer.current = window.setTimeout(() => setCopied(false), 1400)
    } catch { setCopied(false) }
  }
  const activeAction = turn.activity.find(item => item.phase === 'running')
  const failedActions = turn.activity.filter(item => item.phase === 'failed').length
  return <article id={`assistant-turn-${turn.id}`} className="codex-turn" aria-label="对话轮次">
    <div className="codex-user"><p>{turn.prompt}</p><time dateTime={new Date(turn.startedAt).toISOString()}>{timeFormat.format(turn.startedAt)}</time></div>
    <div className="codex-assistant">
      <span className="codex-avatar" aria-hidden="true"><Bot size={18} /></span>
      <div className="codex-reply">
        {turn.activity.length > 0 && <div className="codex-activity">
          <button className="codex-activity-toggle" aria-expanded={expanded} aria-controls={`assistant-activity-${turn.id}`} onClick={() => setExpanded(value => !value)}>
            {activeAction ? <span className="tiny-spinner" /> : failedActions ? <CircleAlert size={15} /> : <Check size={15} />}
            <span>{activeAction?.text ?? (failedActions ? `${failedActions} 项操作需处理` : `完成 ${turn.activity.length} 项工作台操作`)}</span><ChevronDown size={14} />
          </button>
          <AnimatePresence initial={false}>{expanded && <motion.div id={`assistant-activity-${turn.id}`} className="codex-activity-reveal"
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : .19, ease: arrivalEase }}>
            <ul>{turn.activity.map(item => <li key={item.itemId}>
              {item.phase === 'running' ? <span className="tiny-spinner" /> : item.phase === 'failed' ? <CircleAlert size={14} /> : <Check size={14} />}
              <span>{item.text}{item.detail && <small>{item.detail}</small>}</span>
            </li>)}</ul>
          </motion.div>}</AnimatePresence>
        </div>}
        {turn.replies.map(reply => <div key={reply.itemId} className={`codex-answer${reply.complete ? '' : ' is-streaming'}`}>
          {reply.complete ? <Markdown skipHtml remarkPlugins={markdownPlugins} components={{
            a: ({ children, href }) => <span className="codex-reference" title={href}>{children}</span>,
            img: ({ alt }) => alt ? <span>{alt}</span> : null,
            table: ({ children }) => <div className="codex-table"><table>{children}</table></div>
          }}>{reply.text}</Markdown> : reply.text}
        </div>)}
        {turn.state === 'running' && !activeAction && <div className="codex-status" role="status"><span className="tiny-spinner" />{turn.replies.length ? '正在生成回复' : '正在处理请求'}</div>}
        {turn.state === 'stopped' && <div className="codex-status" role="status"><Square size={13} />本轮已停止</div>}
        {turn.state === 'failed' && <div className="codex-turn-error" role="alert"><CircleAlert size={15} /><span>{turn.error}</span>
          <button onClick={() => restore(turn.prompt)}><RotateCcw size={14} />放回输入框</button></div>}
        {turn.state !== 'running' && completeText && <button className="codex-copy" onClick={() => void copy()} aria-label={copied ? '已复制回复' : '复制回复'} title={copied ? '已复制' : '复制回复'}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>}
      </div>
    </div>
  </article>
})

export function CodexWorkspace() {
  const chat = useWorkbenchCodex()
  const sidebarCollapsed = useInterface(state => state.preferences.sidebarCollapsed)
  const reduced = useReducedMotion()
  const [catalog, setCatalog] = useState<WorkbenchCodexModel[]>([])
  const [connection, setConnection] = useState<{ state: 'connecting' | 'ready' | 'offline'; error?: string }>({ state: 'connecting' })
  const [stopping, setStopping] = useState(false)
  const [detached, setDetached] = useState(false)
  const log = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const follow = useRef(true)
  const empty = !chat.turns.length

  const loadModels = async () => {
    setConnection({ state: 'connecting' })
    try {
      const result = await window.workbench.workbenchCodexModels()
      if (result.ok) { setCatalog(result.data); setConnection({ state: 'ready' }) }
      else setConnection({ state: 'offline', error: result.error.message })
    } catch { setConnection({ state: 'offline', error: '无法连接本地 Codex CLI。' }) }
  }
  useEffect(() => { void loadModels() }, [])
  const jumpToLatest = (animate = false) => {
    const element = log.current
    if (!element) return
    follow.current = true
    setDetached(false)
    element.scrollTo({ top: element.scrollHeight, behavior: animate && !reduced ? 'smooth' : 'instant' })
  }
  useEffect(() => {
    const element = log.current, contents = list.current
    if (!element || !contents) return
    const observer = new ResizeObserver(() => { if (follow.current) element.scrollTop = element.scrollHeight })
    observer.observe(contents)
    observer.observe(element)
    return () => observer.disconnect()
  }, [empty])
  useLayoutEffect(() => {
    const textarea = input.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(136, textarea.scrollHeight)}px`
  }, [chat.draft, empty])

  const models = catalog.some(item => item.id === defaultWorkbenchModel) ? catalog : [catalogFallback, ...catalog]
  const selected = models.find(model => model.id === chat.model)
  const manual = !selected
  const available = codexReasoningEfforts.filter(effort => (selected?.efforts ?? catalogFallback.efforts).includes(effort))
  const efforts = [...new Set<CodexReasoningEffort>(['default', ...available, chat.effort])]
  const fill = useCallback((text: string) => {
    useWorkbenchCodex.setState({ draft: text })
    const textarea = input.current
    if (textarea) { textarea.focus(); requestAnimationFrame(() => textarea.setSelectionRange(text.length, text.length)) }
  }, [])
  const send = () => { jumpToLatest(); void chat.send() }
  const stop = async () => {
    setStopping(true)
    try { await window.workbench.interruptWorkbenchCodex() }
    finally { setStopping(false); input.current?.focus() }
  }
  return <main className="codex-workspace">
    <header className="codex-topbar">
      <h1>研究助手</h1>
      <div className="codex-topbar-actions">
        <span className="codex-cli-status" data-state={connection.state} role="status"><i aria-hidden="true" />Codex CLI {connection.state === 'ready' ? '已连接' : connection.state === 'connecting' ? '连接中' : '未连接'}</span>
        {sidebarCollapsed && <CodexNewChat />}
      </div>
    </header>
    <div className={`codex-chat${empty ? ' is-empty' : ''}`}>
      {empty ? <motion.h2 className="codex-welcome codex-column" initial={reduced ? false : { opacity: .65, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : .29, ease: arrivalEase }}>
        今天想推进哪项研究？
      </motion.h2> : <div className="codex-log-region">
        <div ref={log} className="codex-transcript" aria-label="对话记录" tabIndex={0} onScroll={event => {
          const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
          const nearBottom = scrollHeight - scrollTop - clientHeight < 48
          follow.current = nearBottom
          setDetached(!nearBottom)
        }}><div className="codex-turns codex-column" ref={list}>{chat.turns.map(turn => <Turn key={turn.id} turn={turn} restore={fill} />)}</div></div>
        <AnimatePresence>{detached && <motion.button className="codex-jump" onClick={() => jumpToLatest(true)} aria-label="跳到最新回复" title="跳到最新回复"
          initial={{ opacity: 0, y: reduced ? 0 : 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .16 }}><ArrowDown size={17} /></motion.button>}</AnimatePresence>
      </div>}
      <div className="codex-composer-area codex-column">
        {connection.state === 'offline' && <div className="codex-feedback" role="status"><CircleAlert size={15} /><span>{connection.error}</span>
          <Button onClick={() => void loadModels()}>重新连接</Button></div>}
        <form className="codex-composer" onSubmit={event => { event.preventDefault(); send() }}>
          <textarea id="codex-message" ref={input} aria-label="发给研究助手的消息" placeholder="输入问题或操作指令…" rows={1} maxLength={20000} value={chat.draft}
            onChange={event => useWorkbenchCodex.setState({ draft: event.target.value })}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!chat.running) send() }
            }} />
          <div className="codex-composer-controls">
            <div className="codex-options">
              <AssistantPicker label="Codex 模型" disabled={!!chat.running} value={manual ? 'custom' : chat.model}
                options={[...models.map(item => ({ id: item.id, label: item.name })), { id: 'custom', label: '自定义模型' }]}
                onChange={model => {
                  const next = models.find(item => item.id === model)
                  chat.update(model === 'custom' ? '' : model, next?.efforts.length && !next.efforts.includes(chat.effort) ? 'default' : chat.effort)
                }} />
              {manual && <input aria-label="自定义 Codex 模型" placeholder="模型 ID" disabled={!!chat.running} maxLength={100} value={chat.model} onChange={event => chat.update(event.target.value, chat.effort)} />}
              <AssistantPicker label="推理程度" disabled={!!chat.running} value={chat.effort}
                options={efforts.map(effort => ({ id: effort, label: effort === 'default' ? effortLabels[effort] : `推理 · ${effortLabels[effort]}` }))}
                onChange={effort => chat.update(chat.model, effort as CodexReasoningEffort)} />
            </div>
            {chat.running ? <Button key="stop" className="codex-send icon-button" variant="primary" aria-label="停止回复" title="停止回复" disabled={stopping} onClick={() => void stop()}><Square size={15} fill="currentColor" /></Button>
              : <Button key="send" className="codex-send icon-button" type="submit" variant="primary" aria-label="发送给研究助手" title="发送给研究助手" disabled={!chat.draft.trim() || !chat.model.trim()}><ArrowUp size={20} /></Button>}
          </div>
        </form>
        {empty && <div className="codex-starters" role="group" aria-label="常用指令">{starters.map(item => <button key={item.label} onClick={() => fill(item.prompt)}>
          <item.icon size={17} aria-hidden="true" /><span>{item.label}</span>
        </button>)}</div>}
      </div>
    </div>
  </main>
}

import { Brain, FileText, History, Mic, Plus, Trash2 } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { selectTodayWorkout, sendMessage } from '@/coach/coachService'
import { CoachCardView } from '@/components/coach/CoachCards'
import { Composer } from '@/components/coach/Composer'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { CoachMark } from '@/components/ui/Primitives'
import { Sheet } from '@/components/ui/Sheet'
import type { Attachment, Message } from '@/domain/types'
import { useIsDesktop } from '@/lib/hooks'
import { relativeDay, relativeTime } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useStore } from '@/store/useStore'

export function CoachScreen() {
  const navigate = useNavigate()
  const desktop = useIsDesktop()
  const reduce = useReducedMotion()
  const coach = useStore((s) => s.coach)
  const user = useStore((s) => s.user)
  const conversations = useStore((s) => s.conversations)
  const activeId = useStore((s) => s.activeConversationId)
  const messagesById = useStore((s) => s.messages)
  const typing = useStore((s) => s.ui.coachTyping)
  const status = useStore((s) => s.ui.coachStatus)
  const setActive = useStore((s) => s.setActiveConversation)
  const createConversation = useStore((s) => s.createConversation)
  const deleteConversation = useStore((s) => s.deleteConversation)
  const todayWorkout = useStore((s) => selectTodayWorkout(s))
  const activeProgram = useStore((s) => Object.values(s.programs).some((p) => p.status === 'active'))
  const [params, setParams] = useSearchParams()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [prefill, setPrefill] = useState<string | undefined>()
  const listRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const conversation = conversations.find((c) => c.id === activeId) ?? conversations[0]
  const messages = useMemo(() => (conversation ? (messagesById[conversation.id] ?? []) : []), [conversation, messagesById])

  useEffect(() => {
    if (!conversation && conversations.length === 0) createConversation()
    else if (!activeId && conversation) setActive(conversation.id)
  }, [conversation, conversations.length, activeId, createConversation, setActive])

  // Deep links: /coach?prompt=... (auto-send) or /coach?prefill=...
  useEffect(() => {
    const prompt = params.get('prompt')
    const pre = params.get('prefill')
    if (prompt) {
      setParams({}, { replace: true })
      void sendMessage(prompt)
    } else if (pre) {
      setParams({}, { replace: true })
      setPrefill(pre)
    }
  }, [params, setParams])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'end' })
  }, [messages.length, typing, reduce])

  const send = (text: string, attachments: Attachment[] = []) => {
    void sendMessage(text, attachments)
  }

  const contextualPrompts = useMemo(() => {
    const list: string[] = []
    if (todayWorkout?.status === 'planned') list.push('Start my workout', 'Make it shorter', 'I only have dumbbells')
    else if (todayWorkout?.status === 'completed') list.push('How did I do this week?', 'What should I eat now?')
    else list.push('Build today’s workout', 'I only have 30 minutes')
    list.push('What should I eat?')
    if (!activeProgram) list.push('Create a 12-week program')
    list.push('Analyze my progress', 'Plan my week')
    return [...new Set(list)].slice(0, 6)
  }, [todayWorkout, activeProgram])

  const lastCoachIdx = [...messages].map((m, i) => (m.role === 'coach' ? i : -1)).filter((i) => i >= 0).pop()
  const firstName = user?.name.split(' ')[0] ?? ''

  return (
    <div className={cn('flex flex-col', desktop ? 'h-[calc(100dvh-48px)]' : 'h-[calc(100dvh-58px-env(safe-area-inset-bottom))]')}>
      <header className="pt-safe sticky top-0 z-30 blur-bar border-b border-hairline" style={{ background: 'var(--tabbar-bg)' }}>
        <div className="flex items-center gap-3 h-14 px-4">
          <CoachMark size={26} active={typing} />
          <div className="flex-1 min-w-0">
            <div className="title text-[16px] leading-none">{coach.name}</div>
            <div className="text-[11.5px] text-text-3 mt-1 truncate">{typing ? (status ?? 'Thinking…') : conversation?.title === 'New conversation' ? 'Your coach · always here' : (conversation?.title ?? 'Your coach')}</div>
          </div>
          <button aria-label="Coach memory" onClick={() => navigate('/profile/memory')} className="h-10 w-10 rounded-full flex items-center justify-center text-text-2 hover:text-text hover:bg-surface">
            <Brain size={19} />
          </button>
          <button aria-label="Conversations" onClick={() => setHistoryOpen(true)} className="h-10 w-10 rounded-full flex items-center justify-center text-text-2 hover:text-text hover:bg-surface">
            <History size={19} />
          </button>
          <button aria-label="New conversation" onClick={() => createConversation()} className="h-10 w-10 rounded-full flex items-center justify-center text-text-2 hover:text-text hover:bg-surface">
            <Plus size={20} />
          </button>
        </div>
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto no-scrollbar px-4 sm:px-6">
        {messages.length === 0 ? (
          <div className="min-h-full flex flex-col justify-end pb-6">
            <div className="flex-1 flex flex-col items-center justify-center text-center pt-10">
              <CoachMark size={48} active />
              <h2 className="title text-[22px] mt-5">
                {firstName ? `Hey ${firstName}.` : 'Hey.'} What do you need?
              </h2>
              <p className="text-[14px] text-text-3 mt-2 max-w-[280px] text-pretty">Training, food, your plan, how you feel. Talk to me like you would to a coach who already knows you.</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center pt-8">
              {contextualPrompts.map((p) => (
                <Chip key={p} onClick={() => send(p)}>
                  {p}
                </Chip>
              ))}
            </div>
          </div>
        ) : (
          <div className="py-4 space-y-5 max-w-[760px] mx-auto">
            <AnimatePresence initial={false}>
              {messages.map((m, i) => (
                <MessageView key={m.id} message={m} coachName={coach.name} showSuggestions={i === lastCoachIdx && !typing} onSend={send} prevRole={messages[i - 1]?.role} />
              ))}
            </AnimatePresence>
            {typing && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 pl-1">
                <CoachMark size={18} active />
                <div className="flex items-center gap-1.5 h-6">
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-text-2" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-text-2" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-text-2" />
                  {status && <span className="text-[12.5px] text-text-3 ml-2">{status}</span>}
                </div>
              </motion.div>
            )}
            <div ref={endRef} className="h-1" />
          </div>
        )}
      </div>

      <div className="max-w-[760px] w-full mx-auto">
        <Composer placeholder={`Message ${coach.name}`} disabled={typing} onSend={send} initialText={prefill} />
      </div>

      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title="Conversations" size="tall">
        <div className="pb-2">
          <Button
            variant="secondary"
            full
            icon={<Plus size={16} />}
            onClick={() => {
              createConversation()
              setHistoryOpen(false)
            }}
          >
            New conversation
          </Button>
        </div>
        <ul className="divide-y divide-[var(--hairline)]">
          {conversations.map((c) => {
            const count = (messagesById[c.id] ?? []).length
            return (
              <li key={c.id} className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setActive(c.id)
                    setHistoryOpen(false)
                  }}
                  className={cn('flex-1 text-left py-3.5 min-w-0', c.id === conversation?.id && 'text-accent-text')}
                >
                  <div className="text-[15px] font-medium truncate">{c.title}</div>
                  <div className="text-[12px] text-text-3 mt-0.5">
                    {relativeDay(c.updatedAt)} · {count} {count === 1 ? 'message' : 'messages'}
                  </div>
                </button>
                {conversations.length > 1 && (
                  <button aria-label="Delete conversation" onClick={() => deleteConversation(c.id)} className="h-9 w-9 rounded-full flex items-center justify-center text-text-4 hover:text-danger">
                    <Trash2 size={16} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </Sheet>
    </div>
  )
}

function MessageView({ message: m, coachName, showSuggestions, onSend, prevRole }: { message: Message; coachName: string; showSuggestions: boolean; onSend: (t: string) => void; prevRole?: Message['role'] }) {
  const reduce = useReducedMotion()
  if (m.role === 'user') {
    return (
      <motion.div initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.2 }} className="flex flex-col items-end gap-1.5">
        {m.attachments?.map((a) =>
          a.kind === 'image' && a.previewDataUrl ? (
            <img key={a.id} src={a.previewDataUrl} alt={a.name} className="max-w-[70%] max-h-[260px] rounded-[18px] border border-border object-cover" />
          ) : (
            <div key={a.id} className="flex items-center gap-2 rounded-[16px] bg-user-bubble border border-border px-3.5 py-2.5 max-w-[80%]">
              {a.kind === 'audio' ? <Mic size={15} className="text-accent-text" /> : <FileText size={15} className="text-text-2" />}
              <span className="text-[13px] font-medium truncate">{a.name}</span>
            </div>
          ),
        )}
        {m.text && <div className="max-w-[82%] rounded-[20px] rounded-br-[8px] bg-user-bubble px-4 py-2.5 text-[15.5px] leading-[1.45] whitespace-pre-wrap">{m.text}</div>}
        <span className="text-[10.5px] text-text-4 pr-1">{relativeTime(m.createdAt)}</span>
      </motion.div>
    )
  }
  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="max-w-[92%] sm:max-w-[85%]">
      {prevRole !== 'coach' && (
        <div className="flex items-center gap-2 mb-1.5">
          <CoachMark size={16} />
          <span className="text-[12px] font-semibold text-text-2">{coachName}</span>
        </div>
      )}
      <div className="text-[15.5px] leading-[1.55] whitespace-pre-wrap text-pretty pl-0.5">{m.text}</div>
      {m.cards?.length ? (
        <div className="mt-3 space-y-2.5">
          {m.cards.map((c) => (
            <CoachCardView key={c.id} card={c} onSend={onSend} />
          ))}
        </div>
      ) : null}
      {showSuggestions && m.suggestions?.length ? (
        <div className="flex flex-wrap gap-2 mt-3">
          {m.suggestions.map((s) => (
            <Chip key={s} size="sm" tone="accent" onClick={() => onSend(s)}>
              {s}
            </Chip>
          ))}
        </div>
      ) : null}
    </motion.div>
  )
}

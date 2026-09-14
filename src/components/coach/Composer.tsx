import { ArrowUp, Camera, FileText, Image as ImageIcon, Mic, Paperclip, Square, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Attachment } from '@/domain/types'
import { useT } from '@/i18n/react'
import { cn, formatBytes, haptic } from '@/lib/utils'
import { Sheet } from '@/components/ui/Sheet'
import { createAttachmentFromFile, createVoiceAttachment } from './attachments'

interface ComposerProps {
  placeholder: string
  disabled?: boolean
  onSend: (text: string, attachments: Attachment[]) => void
  initialText?: string
}

type SpeechRecognitionCtor = new () => {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}

function getSpeechRecognition(): SpeechRecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

export function Composer({ placeholder, disabled, onSend, initialText }: ComposerProps) {
  const tr = useT()
  const [text, setText] = useState(initialText ?? '')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachOpen, setAttachOpen] = useState(false)
  const [recording, setRecording] = useState<'idle' | 'dictating' | 'recording'>('idle')
  const [recSeconds, setRecSeconds] = useState(0)
  const [processing, setProcessing] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const recRef = useRef<{ stop: () => void } | null>(null)

  useEffect(() => {
    if (initialText) {
      setText(initialText)
      taRef.current?.focus()
    }
  }, [initialText])

  const resize = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = '0px'
    ta.style.height = `${Math.min(140, ta.scrollHeight)}px`
  }, [])
  useEffect(resize, [text, resize])

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled && !processing

  const submit = () => {
    if (!canSend) return
    haptic(8)
    onSend(text.trim(), attachments)
    setText('')
    setAttachments([])
    requestAnimationFrame(resize)
  }

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setProcessing(true)
    try {
      const created = await Promise.all(Array.from(files).slice(0, 4).map(createAttachmentFromFile))
      setAttachments((a) => [...a, ...created].slice(0, 4))
    } finally {
      setProcessing(false)
      setAttachOpen(false)
    }
  }

  const startVoice = async () => {
    if (recording !== 'idle') {
      recRef.current?.stop()
      return
    }
    const SR = getSpeechRecognition()
    if (SR) {
      try {
        const rec = new SR()
        rec.lang = tr.lang === 'fr' ? 'fr-FR' : 'en-US'
        rec.continuous = false
        rec.interimResults = true
        let finalText = ''
        const base = text ? text.replace(/\s+$/, '') + ' ' : ''
        rec.onresult = (e) => {
          let interim = ''
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i]
            if (r.isFinal) finalText += r[0].transcript
            else interim += r[0].transcript
          }
          setText(base + finalText + interim)
        }
        rec.onend = () => {
          setRecording('idle')
          recRef.current = null
          taRef.current?.focus()
        }
        rec.onerror = () => {
          setRecording('idle')
          recRef.current = null
        }
        recRef.current = { stop: () => rec.stop() }
        rec.start()
        setRecording('dictating')
        haptic(10)
        return
      } catch {
        /* fall through to recording */
      }
    }
    // Fallback: record a voice note.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      const chunks: Blob[] = []
      const started = Date.now()
      mr.ondataavailable = (e) => chunks.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' })
        const dur = (Date.now() - started) / 1000
        if (dur >= 1) {
          const att = await createVoiceAttachment(blob, dur)
          setAttachments((a) => [...a, att].slice(0, 4))
        }
        setRecording('idle')
        setRecSeconds(0)
        recRef.current = null
      }
      mr.start()
      setRecording('recording')
      haptic(10)
      const tick = setInterval(() => setRecSeconds(Math.round((Date.now() - started) / 1000)), 500)
      recRef.current = {
        stop: () => {
          clearInterval(tick)
          mr.stop()
        },
      }
    } catch {
      setRecording('idle')
    }
  }

  return (
    <div className="px-3 pt-2 pb-[max(10px,env(safe-area-inset-bottom))]">
      <AnimatePresence>
        {attachments.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex gap-2 overflow-x-auto no-scrollbar pb-2 px-1">
            {attachments.map((a) => (
              <div key={a.id} className="relative shrink-0">
                {a.kind === 'image' && a.previewDataUrl ? (
                  <img src={a.previewDataUrl} alt={a.name} className="h-16 w-16 rounded-[12px] object-cover border border-border" />
                ) : (
                  <div className="h-16 w-[150px] rounded-[12px] bg-surface border border-border flex items-center gap-2 px-3">
                    {a.kind === 'audio' ? <Mic size={16} className="text-accent-text" /> : <FileText size={16} className="text-text-2" />}
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium truncate">{a.name}</div>
                      <div className="text-[11px] text-text-3">{a.kind === 'audio' ? tr.t('coachScreen.voiceNote') : formatBytes(a.size)}</div>
                    </div>
                  </div>
                )}
                <button aria-label={tr.t('coachScreen.removeAttachment')} onClick={() => setAttachments((x) => x.filter((y) => y.id !== a.id))} className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-text text-bg flex items-center justify-center">
                  <X size={12} />
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className={cn('flex items-end gap-1.5 rounded-[26px] border border-border-strong px-1.5 py-1.5 shadow-md blur-bar transition-colors', recording !== 'idle' && 'border-accent')} style={{ background: 'var(--composer-bg)' }}>
        <button aria-label={tr.t('coachScreen.attach')} onClick={() => setAttachOpen(true)} className="h-10 w-10 rounded-full flex items-center justify-center text-text-2 hover:text-text hover:bg-surface-2 shrink-0" disabled={disabled}>
          <Paperclip size={19} />
        </button>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as KeyboardEvent).isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          rows={1}
          placeholder={recording === 'recording' ? tr.t('coachScreen.recording', { s: recSeconds }) : recording === 'dictating' ? tr.t('coachScreen.listening') : placeholder}
          aria-label={tr.t('coachScreen.messageYourCoach')}
          className="flex-1 bg-transparent resize-none outline-none text-[16px] leading-[22px] py-[9px] px-1 placeholder:text-text-4 max-h-[140px]"
          disabled={disabled}
          enterKeyHint="send"
        />
        {canSend ? (
          <motion.button key="send" aria-label={tr.t('coachScreen.send')} onClick={submit} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="h-10 w-10 rounded-full bg-accent text-accent-ink flex items-center justify-center shrink-0 active:scale-95">
            <ArrowUp size={19} strokeWidth={2.5} />
          </motion.button>
        ) : (
          <button
            key="mic"
            aria-label={recording !== 'idle' ? tr.t('coachScreen.stop') : tr.t('coachScreen.voiceInput')}
            onClick={startVoice}
            disabled={disabled}
            className={cn('h-10 w-10 rounded-full flex items-center justify-center shrink-0 transition-colors', recording !== 'idle' ? 'bg-accent text-accent-ink' : 'text-text-2 hover:text-text hover:bg-surface-2')}
          >
            {recording !== 'idle' ? <Square size={16} fill="currentColor" /> : <Mic size={19} />}
          </button>
        )}
      </div>

      <input ref={fileRef} type="file" hidden accept=".pdf,.txt,.md,.csv,.json,application/pdf,text/*" multiple onChange={(e) => addFiles(e.target.files)} />
      <input ref={imageRef} type="file" hidden accept="image/*" multiple onChange={(e) => addFiles(e.target.files)} />
      <input ref={cameraRef} type="file" hidden accept="image/*" capture="environment" onChange={(e) => addFiles(e.target.files)} />

      <Sheet open={attachOpen} onClose={() => setAttachOpen(false)} title={tr.t('coachScreen.addToMessage')}>
        <div className="grid grid-cols-3 gap-2 pb-2">
          <AttachOption icon={<Camera size={22} />} label={tr.t('coachScreen.camera')} onClick={() => cameraRef.current?.click()} />
          <AttachOption icon={<ImageIcon size={22} />} label={tr.t('coachScreen.photo')} onClick={() => imageRef.current?.click()} />
          <AttachOption icon={<FileText size={22} />} label={tr.t('coachScreen.file')} onClick={() => fileRef.current?.click()} />
        </div>
        <p className="text-[12px] text-text-3 text-center pb-2">{tr.t('coachScreen.attachHint')}</p>
        {processing && <p className="text-[12px] text-accent-text text-center">{tr.t('coachScreen.preparing')}</p>}
      </Sheet>
    </div>
  )
}

function AttachOption({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center gap-2 h-[88px] rounded-[18px] bg-surface border border-border hover:border-border-strong text-text-2 hover:text-text active:scale-[0.98]">
      {icon}
      <span className="text-[12px] font-medium">{label}</span>
    </button>
  )
}

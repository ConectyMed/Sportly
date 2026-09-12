import type { Attachment } from '@/domain/types'
import { uid } from '@/lib/utils'
import { makeImagePreview, saveAttachmentBlob } from '@/store/attachments'

function kindOf(file: File): Attachment['kind'] {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return 'pdf'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'document'
}

async function readTextExcerpt(file: File): Promise<string | undefined> {
  const textLike = file.type.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(file.name)
  if (!textLike) return undefined
  try {
    const t = await file.text()
    return t.slice(0, 4000)
  } catch {
    return undefined
  }
}

/** Crude text sniff for PDFs: pulls readable ASCII runs out of uncompressed text objects. */
async function sniffPdfText(file: File): Promise<string | undefined> {
  try {
    const buf = new Uint8Array(await file.slice(0, 400_000).arrayBuffer())
    let s = ''
    for (let i = 0; i < buf.length; i++) {
      const c = buf[i]
      s += c >= 32 && c < 127 ? String.fromCharCode(c) : ' '
    }
    const runs = s.match(/\(([^)]{3,})\)/g)?.map((r) => r.slice(1, -1)) ?? []
    const text = runs.join(' ').replace(/\s+/g, ' ').trim()
    return text.length > 40 ? text.slice(0, 2000) : undefined
  } catch {
    return undefined
  }
}

export async function createAttachmentFromFile(file: File): Promise<Attachment> {
  const id = uid('att')
  const kind = kindOf(file)
  const att: Attachment = {
    id,
    kind,
    name: file.name || `${kind}-${id}`,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    createdAt: new Date().toISOString(),
  }
  if (kind === 'image') att.previewDataUrl = await makeImagePreview(file)
  if (kind === 'document') att.transcript = await readTextExcerpt(file)
  if (kind === 'pdf') att.transcript = await sniffPdfText(file)
  await saveAttachmentBlob(id, file)
  return att
}

export async function createVoiceAttachment(blob: Blob, durationSec: number, transcript?: string): Promise<Attachment> {
  const id = uid('att')
  const att: Attachment = {
    id,
    kind: 'audio',
    name: `Voice note · ${Math.round(durationSec)}s`,
    mimeType: blob.type || 'audio/webm',
    size: blob.size,
    durationSec,
    transcript,
    createdAt: new Date().toISOString(),
  }
  await saveAttachmentBlob(id, blob)
  return att
}

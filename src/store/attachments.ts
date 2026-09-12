import { del, get, set } from 'idb-keyval'

/**
 * Attachment binaries live in IndexedDB (not in the persisted store) so large
 * images/PDFs/voice notes never bloat localStorage.
 */
const PREFIX = 'sportly.attachment.'

export async function saveAttachmentBlob(id: string, blob: Blob): Promise<void> {
  try {
    await set(PREFIX + id, blob)
  } catch {
    /* Storage might be unavailable in private mode; preview data still lives in state. */
  }
}

export async function loadAttachmentBlob(id: string): Promise<Blob | undefined> {
  try {
    return await get<Blob>(PREFIX + id)
  } catch {
    return undefined
  }
}

export async function deleteAttachmentBlob(id: string): Promise<void> {
  try {
    await del(PREFIX + id)
  } catch {
    /* noop */
  }
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** Downscale an image to a small preview so it can be stored inline safely. */
export async function makeImagePreview(file: Blob, max = 640): Promise<string> {
  const dataUrl = await fileToDataUrl(file)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(dataUrl)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

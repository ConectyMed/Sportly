// Renders the Sportly app icon to PNG at the sizes the PWA manifest needs.
// Uses the pre-installed Chromium via Playwright; no native image deps.
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const out = path.resolve('public/icons')
await mkdir(out, { recursive: true })

function svg(size, { maskable = false } = {}) {
  // Maskable icons keep the mark inside the 80% safe zone.
  const r = maskable ? 0 : size * 0.22
  const scale = maskable ? 0.72 : 1
  const c = size / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${r}" fill="#050505"/>
    <circle cx="${c}" cy="${c}" r="${size * 0.25 * scale}" fill="#c6ff3f" opacity="0.2"/>
    <circle cx="${c}" cy="${c}" r="${size * 0.16 * scale}" fill="#c6ff3f"/>
    <circle cx="${c}" cy="${c}" r="${size * 0.07 * scale}" fill="#e6ffa3" opacity="0.9"/>
  </svg>`
}

const executablePath = process.env.CHROMIUM_PATH || (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined)
const browser = await chromium.launch(executablePath ? { executablePath } : {})
const page = await browser.newPage()
const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['../apple-touch-icon.png', 180, false],
]
for (const [name, size, maskable] of targets) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size, { maskable })}</body></html>`)
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
  await writeFile(path.join(out, name), buf)
  console.log('wrote', name)
}
await browser.close()

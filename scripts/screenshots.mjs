// Visual check: capture the main screens in both languages on an iPhone and a desktop viewport.
// Usage: pnpm preview --port 4173 & node scripts/screenshots.mjs [outDir]
import { chromium, devices } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.BASE_URL ?? 'http://localhost:4173'
const out = process.argv[2] ?? 'screenshots'
mkdirSync(out, { recursive: true })
const executablePath = process.env.CHROMIUM_PATH || (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined)
const browser = await chromium.launch(executablePath ? { executablePath } : {})

const routes = [
  ['home', '/'],
  ['coach', '/coach'],
  ['nutrition', '/nutrition'],
  ['progress', '/progress'],
  ['profile', '/profile'],
  ['appearance', '/profile/appearance'],
]

for (const [device, opts] of [
  ['iphone', devices['iPhone 14']],
  ['desktop', devices['Desktop Chrome']],
]) {
  const context = await browser.newContext(opts)
  const page = await context.newPage()
  await page.goto(base + '/')
  await page.getByText('Explore with a demo profile').click()
  await page.getByText('Readiness', { exact: false }).first().waitFor()
  for (const lang of ['en', 'fr']) {
    if (lang === 'fr') {
      await page.goto(base + '/profile/appearance')
      await page.getByRole('tab', { name: 'Français' }).click()
      await page.waitForFunction(() => document.documentElement.lang === 'fr')
    }
    for (const [name, path] of routes) {
      await page.goto(base + path)
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${out}/${device}-${lang}-${name}.png`, fullPage: device === 'desktop' })
    }
    if (lang === 'fr') {
      await page.goto(base + '/coach')
      const box = page.getByRole('textbox', { name: 'Écris à ton coach' })
      await box.fill('Je n’ai que 30 minutes')
      await box.press('Enter')
      await page.waitForTimeout(3500)
      await page.screenshot({ path: `${out}/${device}-fr-coach-reply.png` })
    }
  }
  await context.close()
}
await browser.close()
console.log(`screenshots written to ${out}/`)

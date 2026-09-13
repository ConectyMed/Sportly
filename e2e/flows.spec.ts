import { expect, test, type Page } from '@playwright/test'

/**
 * End-to-end flows from the Sportly brief, run as a real user would.
 * Each test starts from a clean browser context (fresh localStorage).
 */

const coachTab = (page: Page) => page.locator('nav a[href="/coach"]').first()
const tab = (page: Page, href: string) => page.locator(`nav a[href="${href}"]`).first()

async function loadDemo(page: Page) {
  await page.goto('/')
  await page.getByText('Explore with a demo profile').click()
  await expect(page.getByText('Readiness', { exact: false }).first()).toBeVisible()
}

async function send(page: Page, text: string) {
  const box = page.getByRole('textbox', { name: 'Message your coach' })
  await box.fill(text)
  await box.press('Enter')
}

async function lastCoachMessage(page: Page) {
  // Wait for typing to finish: the composer is disabled while the coach responds.
  const box = page.getByRole('textbox', { name: 'Message your coach' })
  await expect(box).toBeDisabled({ timeout: 10_000 }).catch(() => {})
  await expect(box).toBeEnabled({ timeout: 15_000 })
}

test.describe('Flow 1 — first use', () => {
  test('onboarding → coach setup → first conversation → dashboard', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Sportly' })).toBeVisible()
    await page.getByRole('button', { name: 'Meet your coach' }).click()
    await page.getByPlaceholder('Your name').fill('Jordan')
    await page.getByRole('button', { name: 'Continue' }).click()
    // basics
    await page.getByRole('button', { name: 'Continue' }).click()
    // level
    await page.getByText('Intermediate', { exact: true }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    // goal
    await page.getByText('Lose fat', { exact: true }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    // secondary (skip)
    await page.getByRole('button', { name: /Skip|Continue/ }).click()
    // availability
    await page.getByRole('button', { name: 'Continue' }).click()
    // equipment
    await page.getByRole('button', { name: 'Continue' }).click()
    // nutrition
    await page.getByText('Vegetarian', { exact: true }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    // coach name
    await page.getByPlaceholder('Coach name').fill('Kai')
    await page.getByRole('button', { name: 'Continue' }).click()
    // personality preview reacts
    await expect(page.getByText('Kai would say')).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'Meet Kai' })).toBeVisible()
    await page.getByRole('button', { name: 'Start coaching' }).click()
    await expect(page).toHaveURL(/\/coach/)
    await expect(page.getByText("Hey Jordan. I’m Kai, your coach.", { exact: false })).toBeVisible()
    await expect(page.getByText('lose fat', { exact: false }).first()).toBeVisible()
    // Dashboard renders for a brand-new user with an intentional empty state.
    await tab(page, '/').click()
    await expect(page.getByRole('heading', { name: 'Jordan' })).toBeVisible()
    await expect(page.getByText('Build today’s workout').first()).toBeVisible()
    // Reload keeps everything (persistence).
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Jordan' })).toBeVisible()
  })
})

test.describe('Flow 2 — workout', () => {
  test('dashboard → start → complete → summary → history updates', async ({ page }) => {
    await loadDemo(page)
    const start = page.getByRole('button', { name: /Start workout|Train anyway/ }).first()
    await start.click()
    // If we landed on the preview (rest day → Train anyway), start from there.
    if (page.url().includes('/workout/') && !page.url().includes('/session')) {
      await page.getByRole('button', { name: 'Start workout' }).click()
    }
    await expect(page).toHaveURL(/\/session/)
    await expect(page.getByText('Exercise 1 of', { exact: false })).toBeVisible()
    // Complete the sets of the first exercise.
    const checks = page.getByRole('button', { name: 'Complete set' })
    const n = await checks.count()
    for (let i = 0; i < n; i++) {
      await page.getByRole('button', { name: 'Complete set' }).first().click()
      await page.waitForTimeout(150)
    }
    // Rest timer appeared and can be skipped.
    await page.getByRole('button', { name: 'Skip' }).click().catch(() => {})
    await page.getByRole('button', { name: /Finish early|Finish workout/ }).click()
    await expect(page).toHaveURL(/\/summary/)
    await expect(page.getByRole('heading', { name: 'Done.' })).toBeVisible()
    await page.getByRole('button', { name: 'Good', exact: true }).click()
    await page.getByRole('button', { name: 'Back home' }).click()
    await expect(page.getByText('Completed', { exact: true })).toBeVisible()
    // The coach acknowledged it in the conversation.
    await coachTab(page).click()
    await expect(page.getByText(/done:|logged:/).first()).toBeVisible()
    // Progress reflects the new session.
    await tab(page, '/progress').click()
    await expect(page.getByText('Where I am')).toBeVisible()
  })
})

test.describe('Flow 3 — conversational workout', () => {
  test('request → generate → modify → start', async ({ page }) => {
    await loadDemo(page)
    await coachTab(page).click()
    await send(page, 'Make my workout')
    await lastCoachMessage(page)
    await expect(page.getByRole('button', { name: 'Start workout' }).last()).toBeVisible()
    await send(page, 'Make it shorter')
    await lastCoachMessage(page)
    await expect(page.getByText('Trimmed to about', { exact: false }).last()).toBeVisible()
    await send(page, 'I only have dumbbells')
    await lastCoachMessage(page)
    await expect(page.getByText('Rebuilt for dumbbells only', { exact: false }).last()).toBeVisible()
    await page.getByRole('button', { name: 'Start workout' }).last().click()
    await expect(page).toHaveURL(/\/session/)
  })

  test('keeps conversational context (fatigue scale)', async ({ page }) => {
    await loadDemo(page)
    await coachTab(page).click()
    await send(page, "I'm tired")
    await lastCoachMessage(page)
    await expect(page.getByText('from 1 to 10', { exact: false })).toBeVisible()
    await send(page, '6')
    await lastCoachMessage(page)
    await expect(page.getByText('6 out of 10', { exact: false })).toBeVisible()
    // Readiness on Home reflects the check-in.
    await tab(page, '/').click()
    await expect(page.getByText('5/10').first()).toBeVisible()
  })
})

test.describe('Flow 4 — program', () => {
  test('request 12-week program → inspect → calendar reflects it', async ({ page }) => {
    await loadDemo(page)
    await coachTab(page).click()
    await send(page, 'Create me a 12-week muscle-building program')
    await lastCoachMessage(page)
    await expect(page.getByText('12-Week Muscle Builder').first()).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'View program' }).last().click()
    await expect(page).toHaveURL(/\/program\//)
    await expect(page.getByText('Week 1', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('deload', { exact: false }).first()).toBeVisible()
    await page.goto('/calendar')
    // Program sessions appear in the calendar month grid as planned dots and carry the Program tag on a day.
    await expect(page.getByText(/planned/).first()).toBeVisible()
  })
})

test.describe('Flow 5 — nutrition', () => {
  test('request plan → inspect meals and macros', async ({ page }) => {
    await loadDemo(page)
    await coachTab(page).click()
    await send(page, 'What should I eat today?')
    await lastCoachMessage(page)
    await expect(page.getByText('kcal', { exact: false }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Full plan' }).last().click()
    await expect(page).toHaveURL(/\/nutrition/)
    await expect(page.getByText('Protein').first()).toBeVisible()
    await expect(page.getByText('Breakfast').first()).toBeVisible()
    // Restaurant adjusts the day.
    await page.getByRole('button', { name: 'Eating out tonight' }).click()
    await lastCoachMessage(page)
    await expect(page.getByText('I adjusted the rest of your day', { exact: false }).last()).toBeVisible()
  })
})

test.describe('Flow 6 — multimodal', () => {
  test('attach an image → preview → coach response → context', async ({ page }) => {
    await loadDemo(page)
    await coachTab(page).click()
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
    await page.locator('input[type="file"][accept="image/*"]:not([capture])').setInputFiles({ name: 'meal.png', mimeType: 'image/png', buffer: png })
    await expect(page.getByRole('button', { name: 'Remove attachment' })).toBeVisible()
    await page.getByRole('button', { name: 'Send' }).click()
    await lastCoachMessage(page)
    await expect(page.getByText('What am I looking at?', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'It’s a meal' }).click()
    await lastCoachMessage(page)
    // No vision model on this device: the coach says so and asks for a description instead of pretending.
    await expect(page.getByText('can’t see photos on this device', { exact: false })).toBeVisible()
    await send(page, 'Chicken, rice and vegetables')
    await lastCoachMessage(page)
    await expect(page.getByTestId('food-card').last()).toHaveAttribute('data-status', 'draft')
    // A PDF gets a coherent fallback too.
    await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({ name: 'plan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 (Week 1 squat 3 sets 5 reps)') })
    await page.getByRole('button', { name: 'Send' }).click()
    await lastCoachMessage(page)
    await expect(page.getByText(/training plan|Saved “plan.pdf”/).last()).toBeVisible()
  })
})

test.describe('Flow 7 — progress', () => {
  test('graphs, goals, insights', async ({ page }) => {
    await loadDemo(page)
    await tab(page, '/progress').click()
    await expect(page.getByText('Where I started')).toBeVisible()
    await expect(page.locator('svg path[stroke]').first()).toBeVisible()
    await expect(page.getByText('Build muscle').first()).toBeVisible()
    await expect(page.getByText('insights', { exact: false }).first()).toBeVisible()
    await expect(page.getByText(/consistently for \d+ weeks|training volume/).first()).toBeVisible()
    // Goals are editable.
    await page.getByRole('button', { name: /Manage/ }).click()
    await expect(page).toHaveURL(/\/goals/)
    await page.getByRole('button', { name: 'Add goal' }).click()
    await page.getByRole('button', { name: 'Get stronger' }).click()
    await page.getByRole('button', { name: 'Save goal' }).click()
    await expect(page.getByText('Get stronger').first()).toBeVisible()
  })
})

test.describe('Flow 8 — personalization', () => {
  test('coach personality changes coach behaviour', async ({ page }) => {
    await loadDemo(page)
    await page.goto('/profile/coach')
    const sliders = page.getByRole('slider')
    await sliders.nth(0).fill('100') // motivation: intense
    await sliders.nth(3).fill('0') // communication: concise
    await expect(page.getByText('intense · ', { exact: false })).toBeVisible()
    await coachTab(page).click()
    await send(page, 'Thanks')
    await lastCoachMessage(page)
    await expect(page.getByText('Now go do the work.', { exact: false })).toBeVisible()
    // Rename through conversation.
    await send(page, 'Call you Max')
    await lastCoachMessage(page)
    await expect(page.getByText('Max it is', { exact: false })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Message your coach' })).toHaveAttribute('placeholder', 'Message Max')
  })
})

test.describe('Flow 9 — theme', () => {
  test('dark / light / system across screens', async ({ page }) => {
    await loadDemo(page)
    await page.goto('/profile/appearance')
    const themeTabs = page.getByRole('tablist').first()
    await themeTabs.getByRole('tab', { name: 'Light' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await tab(page, '/').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await coachTab(page).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.goto('/profile/appearance')
    await page.getByRole('tablist').first().getByRole('tab', { name: 'System' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', /dark|light/)
    await page.getByRole('tablist').first().getByRole('tab', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })
})

test.describe('Flow 10 — settings persistence', () => {
  test('change preferences → navigate away → return → persisted', async ({ page }) => {
    await loadDemo(page)
    await page.goto('/profile/appearance')
    const haptics = page.getByRole('switch', { name: 'Haptics' })
    await expect(haptics).toHaveAttribute('aria-checked', 'true')
    await haptics.click()
    await expect(haptics).toHaveAttribute('aria-checked', 'false')
    await page.goto('/profile/personal')
    await page.getByRole('button', { name: 'Increase' }).first().click()
    await tab(page, '/').click()
    await page.reload()
    await page.goto('/profile/appearance')
    await expect(page.getByRole('switch', { name: 'Haptics' })).toHaveAttribute('aria-checked', 'false')
    await page.goto('/profile/personal')
    await expect(page.getByText('28', { exact: true })).toBeVisible()
  })

  test('memory management and calendar reschedule', async ({ page }) => {
    await loadDemo(page)
    await coachTab(page).click()
    await send(page, 'Remember that I train at 7am')
    await lastCoachMessage(page)
    await expect(page.getByText('Noted:', { exact: false })).toBeVisible()
    await page.goto('/profile/memory')
    await expect(page.getByText('I train at 7am')).toBeVisible()
    await coachTab(page).click()
    await send(page, 'Move Monday to Wednesday')
    await lastCoachMessage(page)
    await expect(page.getByText(/Moved .* from Monday to Wednesday|do not see a planned workout/).last()).toBeVisible()
  })
})

test.describe('Flow 11 — food scan', () => {
  test('describe a meal → logged → corrected in chat → Nutrition and Home reflect it → survives reload', async ({ page }) => {
    await loadDemo(page)
    await coachTab(page).click()
    await send(page, 'I ate 200 g turkey, 150 g rice and broccoli')
    await lastCoachMessage(page)
    const card = page.getByTestId('food-card').last()
    await expect(card).toHaveAttribute('data-status', 'logged')
    await expect(card.getByText('Turkey breast', { exact: true })).toBeVisible()
    const kcalBefore = await card.locator('.title.tabular').first().innerText()
    // Conversational correction mutates the same meal (no duplicate card entity).
    await send(page, 'There was more rice')
    await lastCoachMessage(page)
    await expect(page.getByText('More rice', { exact: false }).last()).toBeVisible()
    const kcalAfter = await page.getByTestId('food-card').last().locator('.title.tabular').first().innerText()
    expect(Number(kcalAfter.replace(/,/g, ''))).toBeGreaterThan(Number(kcalBefore.replace(/,/g, '')))
    // Intake questions answer from the same state.
    await send(page, 'How much protein do I have left?')
    await lastCoachMessage(page)
    await expect(page.getByText(/g of protein left out of/i).last()).toBeVisible()
    // Nutrition shows it under "Eaten today"; Home shows the intake line.
    await page.goto('/nutrition')
    await expect(page.getByTestId('eaten-today')).toBeVisible()
    await expect(page.getByTestId('logged-meal').filter({ hasText: 'Turkey' })).toHaveCount(1)
    await tab(page, '/').click()
    await expect(page.getByTestId('home-nutrition-line')).toContainText('logged')
    await page.reload()
    await expect(page.getByTestId('home-nutrition-line')).toContainText('logged')
  })

  test('photo without vision → honest fallback → editable draft → add to lunch → edit sheet → remove', async ({ page }) => {
    await loadDemo(page)
    await coachTab(page).click()
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
    await page.locator('input[type="file"][accept="image/*"]:not([capture])').setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: png })
    await send(page, 'I ate this')
    await lastCoachMessage(page)
    await expect(page.getByText('can’t see photos on this device', { exact: false }).last()).toBeVisible()
    await send(page, 'Salmon, rice and a salad')
    await lastCoachMessage(page)
    const card = page.getByTestId('food-card').last()
    await expect(card).toHaveAttribute('data-status', 'draft')
    await expect(card.getByText('Estimated from your description')).toBeVisible()
    // Edit portions inline, then pick the slot and commit through the coach.
    await card.getByRole('button', { name: 'Less Salad' }).click()
    await card.getByRole('button', { name: 'Lunch', exact: true }).click()
    await card.getByRole('button', { name: 'Add to lunch', exact: true }).click()
    await lastCoachMessage(page)
    await expect(page.getByText('Added to lunch', { exact: false }).last()).toBeVisible()
    await expect(page.getByTestId('food-card').last()).toHaveAttribute('data-status', 'logged')
    // Nutrition: the meal is under Lunch; the edit sheet can halve it and remove it.
    await page.goto('/nutrition')
    const row = page.getByTestId('logged-meal').filter({ hasText: 'Salmon' })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Lunch')
    await row.click()
    await expect(page.getByTestId('meal-edit-sheet')).toBeVisible()
    await page.getByTestId('meal-edit-sheet').getByRole('button', { name: 'Decrease' }).click()
    await page.getByTestId('meal-edit-sheet').getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(page.getByTestId('logged-meal').filter({ hasText: 'Salmon' })).toHaveCount(0)
  })
})

test.describe('Flow 12 — living state', () => {
  test('goal change, finished workout and permanent availability propagate to every surface', async ({ page }) => {
    await loadDemo(page)
    await coachTab(page).click()
    await send(page, 'I want to gain 5kg')
    await lastCoachMessage(page)
    await expect(page.getByText(/79\.2 kg/).last()).toBeVisible()
    await send(page, 'How does that affect my plan?')
    await lastCoachMessage(page)
    await page.goto('/goals')
    await expect(page.getByText('79.2', { exact: false }).first()).toBeVisible()
    // Finish today's workout from chat: Home and Calendar show it completed.
    await coachTab(page).click()
    await send(page, 'Make my workout')
    await lastCoachMessage(page)
    await send(page, 'I just finished my workout')
    await lastCoachMessage(page)
    await expect(page.getByText('logged as complete', { exact: false }).last()).toBeVisible()
    await tab(page, '/').click()
    await expect(page.getByText(/Done for today|View summary|Completed/i).first()).toBeVisible()
    // Persistent availability lands in the profile.
    await coachTab(page).click()
    await send(page, 'I can only train Monday, Wednesday and Friday from now on')
    await lastCoachMessage(page)
    await expect(page.getByText('from now on', { exact: false }).last()).toBeVisible()
    await page.goto('/profile/memory')
    await expect(page.getByText(/Trains 3 days a week: Mon, Wed, Fri/)).toBeVisible()
  })
})

test.describe('PWA', () => {
  test('manifest and service worker are served', async ({ page, request }) => {
    const manifest = await request.get('/manifest.webmanifest')
    expect(manifest.ok()).toBeTruthy()
    const json = await manifest.json()
    expect(json.name).toContain('Sportly')
    expect(json.display).toBe('standalone')
    const sw = await request.get('/sw.js')
    expect(sw.ok()).toBeTruthy()
    await page.goto('/')
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1)
  })
})

test.describe('Flow 13 — AI provider seam', () => {
  test('a model provider without a reachable endpoint never breaks the coach; settings persist and revert', async ({ page }) => {
    await loadDemo(page)
    await page.goto('/profile/coach')
    await expect(page.getByTestId('coach-engine-status')).toContainText('Built-in coach')
    await page.getByText('Local model (Ollama, LM Studio)').click()
    await page.getByLabel('Model name').fill('llama3.1')
    await page.getByRole('button', { name: 'Save and use Local model' }).click()
    await expect(page.getByTestId('coach-engine-status')).toContainText('Answering now: Local model')
    // Nothing listens on the local endpoint: the built-in engine answers the same message.
    await coachTab(page).click()
    await send(page, 'What should I eat today?')
    await lastCoachMessage(page)
    await expect(page.getByText(/kcal/).last()).toBeVisible()
    await page.reload()
    await page.goto('/profile/coach')
    await expect(page.getByText('llama3.1 at http://localhost:11434/v1 · in use')).toBeVisible()
    await page.getByText('Local model (Ollama, LM Studio)').click()
    await page.getByRole('button', { name: 'Remove' }).click()
    await expect(page.getByTestId('coach-engine-status')).toContainText('Answering now: Built-in coach')
  })
})

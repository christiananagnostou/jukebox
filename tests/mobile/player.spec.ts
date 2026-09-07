import { test, expect } from '@playwright/test'

test.afterEach(async ({ request }) => {
  await request.post('/test/network?offline=0')
})
test('Qwik resumes under strict CSP, navigates without replacing audio, and retains controls', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/')
  await expect(page.locator('.album-item')).toBeVisible()
  await expect(page.locator('#view-title')).toHaveText('Albums')
  await page.locator('.album-item').click()
  await expect(page.locator('[data-track-id]')).toHaveCount(6)
  await page.locator('[data-track-id="0"]').click()
  await page.waitForFunction(() => {
    const audio = document.querySelector('audio')!
    return !audio.paused && audio.currentTime > 0
  })
  const audio = await page.locator('audio').elementHandle()
  await page.locator('[data-view="artists"]').click()
  await expect(page.locator('.artist-item')).toBeVisible()
  await page.locator('.artist-item').click()
  await expect(page.locator('.album-item')).toBeVisible()
  expect(await audio!.evaluate((element) => element === document.querySelector('audio') && !element.paused)).toBe(true)
  await page.locator('#mini-player [data-transport="next"]').click()
  await expect(page.locator('#mini-title')).toHaveText('Song 2')
  await page.locator('#open-player').click()
  await page.waitForFunction(
    () => document.querySelector('dialog')!.open && document.querySelector('dialog')!.getAnimations().length === 0
  )
  await expect(page.locator('#now-playing')).toHaveText('Song 2')
  const seek = await page.locator('#seek').boundingBox()
  await page.mouse.move(seek!.x + seek!.width * 0.4, seek!.y + 6)
  await page.mouse.down()
  await page.mouse.move(seek!.x + seek!.width * 0.6, seek!.y + 6, { steps: 4 })
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelector('audio')!.currentTime > 16)
  await page.locator('.transport [data-transport="previous"]').click()
  await expect(page.locator('#now-playing')).toHaveText('Song 2')
  await page.locator('.transport [data-transport="toggle"]').click()
  await expect(page.locator('.transport [data-transport="toggle"]')).toHaveAttribute('aria-label', 'Play')
  await expect(page.locator('#player-heading')).toHaveText('Now playing')
  await expect(page.locator('#playback-actions button')).toHaveCount(0)
  await page.locator('#show-queue').click()
  await page.locator('.queue-track').nth(1).click()
  await expect(page.locator('#now-playing')).toHaveText('Song 3')
  await page.waitForFunction(() => {
    const audio = document.querySelector('audio')!
    return !audio.paused && audio.currentTime > 0.1 && Number.isFinite(audio.duration)
  })
  await page.locator('audio').evaluate((element) => {
    element.currentTime = element.duration - 0.15
  })
  await expect(page.locator('#now-playing')).toHaveText('Song 4')
  await page.waitForFunction(() => document.querySelector('audio')!.currentTime > 0.3)
  await expect(page.locator('#now-playing')).toHaveText('Song 4')
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog')).not.toBeVisible()
  await page.setViewportSize({ width: 320, height: 568 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  expect(errors).toEqual([])
})

test('saved audio and all Qwik screens work after an unavailable-host reload', async ({
  page,
  context,
  request,
  browserName,
}) => {
  await page.goto('/')
  await expect(page.locator('.album-item')).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await page.locator('#refresh-library').click()
  await page.locator('[data-view="artists"]').click()
  await expect(page.locator('.artist-item')).toBeVisible()
  await page.locator('[data-view="tracks"]').click()
  await page.locator('[data-track-id="0"]').click()
  await page.locator('#open-player').click()
  await page.locator('#save-offline').click()
  await expect(page.locator('#save-offline')).toHaveText('Remove offline copy')
  if (browserName === 'chromium') await context.setOffline(true)
  else await request.post('/test/network?offline=1')
  await page.reload()
  await expect(page.locator('.album-item')).toBeVisible()
  await expect(page.locator('#status')).toContainText('Offline')
  await page.locator('[data-view="artists"]').click()
  await expect(page.locator('.artist-item')).toBeVisible()
  await page.locator('#open-player').click()
  await expect(page.locator('#now-playing')).toHaveText('Song 1')
  await page.locator('.transport [data-transport="toggle"]').click()
  await page.waitForFunction(() => !document.querySelector('audio')!.paused)
  const range = await page.evaluate(async () => {
    const response = await fetch('/api/tracks/0/stream', { headers: { Range: 'bytes=100-199' } })
    return { status: response.status, size: (await response.arrayBuffer()).byteLength }
  })
  expect(range).toEqual({ status: 206, size: 100 })
  await context.setOffline(false)
})

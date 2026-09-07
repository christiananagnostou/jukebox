import { test, expect } from '@playwright/test'

const settled = async (page: import('@playwright/test').Page) => {
  await page.waitForFunction(() => {
    const panel = document.querySelector('dialog')!
    return panel.open && !panel.getAnimations({ subtree: true }).length
  })
}

test('sheet follows a pull, restores scrolling/focus, and leaves playback controls independent', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 })
  await page.goto('/')
  await page.locator('[data-view="tracks"]').click()
  await expect(page.locator('[data-track-id]')).toHaveCount(6)
  await page.evaluate(() => window.scrollTo(0, 150))
  const scroll = await page.evaluate(() => window.scrollY)
  await page.locator('#open-player').click()
  await settled(page)
  await expect(page.locator('#player-heading')).toBeFocused()
  expect(await page.locator('body').evaluate((element) => getComputedStyle(element).position)).toBe('fixed')
  const handle = await page.locator('#sheet-handle').boundingBox()
  expect(handle!.height).toBeGreaterThanOrEqual(44)
  const x = handle!.x + handle!.width / 2,
    y = handle!.y + handle!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 90, { steps: 8 })
  const dragging = await page
    .locator('[data-sheet-surface]')
    .evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42)
  expect(dragging).toBeGreaterThan(70)
  expect(
    await page.locator('[data-sheet-overlay]').evaluate((element) => Number(getComputedStyle(element).opacity))
  ).toBeLessThan(1)
  // A deliberate held gesture must not retain the initial flick's velocity.
  await page.waitForTimeout(180)
  await page.mouse.up()
  await settled(page)
  expect(await page.locator('[data-sheet-surface]').evaluate((element) => getComputedStyle(element).transform)).toBe(
    'none'
  )
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 360, { steps: 12 })
  await page.mouse.up()
  await expect(page.locator('dialog')).not.toBeVisible()
  await expect(page.locator('#open-player')).toBeFocused()
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll)
  await page.locator('#open-player').click()
  await settled(page)
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog')).not.toBeVisible()
  expect(await page.locator('body').evaluate((element) => getComputedStyle(element).position)).not.toBe('fixed')
})

test('reduced motion fades, keeps the header reachable, and permits backdrop dismissal', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1000, height: 700 })
  await page.goto('/')
  await page.locator('#open-player').click()
  await settled(page)
  const surface = page.locator('[data-sheet-surface]')
  expect(await surface.evaluate((element) => getComputedStyle(element).transform)).toBe('none')
  await page.locator('#show-queue').click()
  await expect(page.locator('#close-player')).toBeInViewport()
  await page.mouse.click(20, 350)
  await expect(page.locator('dialog')).not.toBeVisible()
  await expect(page.locator('#open-player')).toBeFocused()
})

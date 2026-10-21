import { expect, test } from '@playwright/test';
import path from 'node:path';

test('Editor AI tab and floating entry share one panel without rebuilding AVCanvas', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/editor', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: '上传视频' })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加字幕' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ 视频轨' })).toBeVisible();
  await expect(page.locator('.webav-preview canvas')).toHaveCount(1);
  await page.evaluate(() => { (window as Window & { editorAiCanvas?: Element | null }).editorAiCanvas = document.querySelector('.webav-preview canvas'); });

  const propertyTab = page.getByRole('tab', { name: '属性', exact: true });
  const aiTab = page.getByRole('tab', { name: 'AI 助手', exact: true });
  await expect(propertyTab).toHaveAttribute('aria-selected', 'true');
  await aiTab.click();
  await expect(aiTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('ai-project-summary')).toContainText('0 个视频素材，0 个片段，4 条轨道');
  await expect(page.getByLabel('AI 运行模式')).toHaveValue('mock');
  await expect(page.getByLabel('AI 任务方式')).toHaveValue('assist');
  await page.screenshot({ path: 'test-results/editor-ai-panel.png' });
  await propertyTab.click();
  await expect(page.getByText('选择时间轴片段以编辑属性')).toBeVisible();
  await page.getByRole('button', { name: '打开 AI 助手' }).click();
  await expect(aiTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.property-panel .smart-edit')).toHaveCount(1);
  expect(await page.evaluate(() => document.querySelector('.webav-preview canvas') === (window as Window & { editorAiCanvas?: Element | null }).editorAiCanvas)).toBe(true);
});

test('Editor Mock plan uses imported media and only changes the timeline after confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/editor', { waitUntil: 'domcontentloaded' });
  const h264 = await page.evaluate(async () => {
    try { return (await VideoDecoder.isConfigSupported({ codec: 'avc1.42E01E', codedWidth: 1280, codedHeight: 720 })).supported; }
    catch { return false; }
  });
  test.skip(!h264, '当前无头浏览器不支持 H.264 VideoDecoder；需要在支持 H.264 的 Chrome/Edge 运行媒体集成测试');
  await page.getByLabel('导入视频').setInputFiles(path.resolve('public/demo/coast.mp4'));
  await expect(page.locator('.topbar .status')).toContainText('已导入', { timeout: 30000 });
  const before = await page.locator('.timeline-clip').count();
  expect(before).toBe(1);
  await page.getByRole('tab', { name: 'AI 助手' }).click();
  await expect(page.getByTestId('ai-project-summary')).toContainText('1 个视频素材，1 个片段');
  await page.getByLabel('AI 任务方式').selectOption('rebuild');
  await page.locator('.smart-asset').filter({ hasText: 'coast.mp4' }).getByRole('checkbox').check();
  await page.getByLabel('智能剪辑要求').fill('剪成 2 秒，加一个标题');
  let requests = 0;
  page.on('request', request => { if (request.url().includes('/api/ai/plan')) requests++; });
  await page.getByRole('button', { name: '1. 在本机抽帧（不上传）' }).click();
  await expect(page.locator('.smart-frames img')).toHaveCount(3, { timeout: 30000 });
  expect(requests).toBe(0);
  await page.getByRole('button', { name: '2. 确认运行 Mock 测试' }).click();
  await expect(page.locator('.smart-edit')).toContainText('成片：2 秒');
  expect(requests).toBe(1);
  await expect(page.locator('.timeline-clip')).toHaveCount(before);
  page.once('dialog', dialog => void dialog.dismiss());
  await page.getByRole('button', { name: '3. 确认替换时间线' }).click();
  await expect(page.locator('.timeline-clip')).toHaveCount(before);
  page.once('dialog', dialog => void dialog.accept());
  await page.getByRole('button', { name: '3. 确认替换时间线' }).click();
  await expect(page.locator('.timeline-clip.video')).toHaveCount(1);
  await expect(page.locator('.timeline-clip.caption')).toHaveCount(1);
  await expect(page.getByTestId('project-duration')).toHaveAttribute('data-duration-ms', '2000');
  await page.getByRole('button', { name: '撤销本次 AI 应用' }).click();
  await expect(page.locator('.timeline-clip')).toHaveCount(before);
  await expect(page.getByTestId('project-duration')).not.toHaveAttribute('data-duration-ms', '2000');
});

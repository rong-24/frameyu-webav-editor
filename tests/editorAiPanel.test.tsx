// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { addAsset, appendVideoClip } from '../src/editor/commands';
import { emptyProject } from '../src/editor/types';
import { SmartEditPanel } from '../src/ai/SmartEditPanel';
import { extractFrames } from '../src/ai/extractFrames';
import { mockPlan } from '../shared/plan.mjs';

vi.mock('../src/ai/extractFrames', () => ({ extractFrames: vi.fn() }));
const asset = { id: 'editor-video', name: '我的素材.mp4', type: 'video' as const, mimeType: 'video/mp4', durationMs: 25000, width: 1280, height: 720 };
const project = appendVideoClip(addAsset(emptyProject(), asset), asset);
const frames = [2500, 12500, 22500].map(timeMs => ({ assetId: asset.id, timeMs, image: 'data:image/jpeg;base64,AA==' }));
const files = new Map([[asset.id, new File(['media'], asset.name, { type: asset.mimeType })]]);
const media = [{ id: asset.id, durationMs: asset.durationMs, width: asset.width, height: asset.height }];
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(extractFrames).mockResolvedValue(frames);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function button(label: string) {
  const found = [...container.querySelectorAll('button')].find(element => element.textContent === label);
  if (!found) throw Error(`missing button: ${label}`);
  return found;
}
async function click(element: HTMLElement) { await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); }

it('binds to the Editor project and File, sends no request before consent, and only shows a Mock plan', async () => {
  const onApply = vi.fn();
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mode: 'mock', plan: mockPlan({ prompt: '剪成 2 秒', assets: media }), analysis: { frames: frames.map(frame => ({ assetId: frame.assetId, timeMs: frame.timeMs, description: 'Mock：未分析此帧' })) } }) });
  vi.stubGlobal('fetch', fetcher);
  const before = JSON.stringify(project);
  act(() => root.render(<SmartEditPanel editorIntegration project={project} selectedClipId={project.clips[0].id} files={files} disabled={false} onApply={onApply} />));
  expect(container.querySelector('[data-testid="ai-project-summary"]')?.textContent).toContain('我的素材.mp4');
  expect((container.querySelector('[aria-label="AI 运行模式"]') as HTMLSelectElement).value).toBe('mock');
  await click(container.querySelector('input[type="checkbox"]')! as HTMLElement);
  await click(button('1. 在本机抽帧（不上传）'));
  expect(extractFrames).toHaveBeenCalledWith(media, files);
  expect(fetcher).not.toHaveBeenCalled();
  await click(button('2. 确认运行 Mock 测试'));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ mode: 'mock', consent: true, assets: media });
  expect(container.textContent).toContain('成片：2 秒');
  expect(container.textContent).toContain('仅供参考，不能应用到当前工程');
  expect(onApply).not.toHaveBeenCalled();
  expect(JSON.stringify(project)).toBe(before);
});

it('rejects an invalid plan and leaves the Editor project untouched', async () => {
  const onApply = vi.fn();
  const invalid = mockPlan({ prompt: '剪成 2 秒', assets: media });
  invalid.segments[0].outMs = asset.durationMs + 1;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mode: 'mock', plan: invalid, analysis: { frames: [] } }) }));
  const before = JSON.stringify(project);
  act(() => root.render(<SmartEditPanel editorIntegration project={project} files={files} disabled={false} onApply={onApply} />));
  await click(container.querySelector('input[type="checkbox"]')! as HTMLElement);
  await click(button('1. 在本机抽帧（不上传）'));
  await click(button('2. 确认运行 Mock 测试'));
  expect(container.querySelector('[role="status"]')?.textContent).toContain('超出范围');
  expect(onApply).not.toHaveBeenCalled();
  expect(JSON.stringify(project)).toBe(before);
});

it('requires explicit confirmation before a rebuild plan can invoke Editor application', async () => {
  const onApply = vi.fn();
  const plan = mockPlan({ prompt: '剪成 2 秒', assets: media });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mode: 'mock', plan, analysis: { frames: frames.map(frame => ({ assetId: frame.assetId, timeMs: frame.timeMs, description: 'Mock：未分析此帧' })) } }) }));
  const confirm = vi.fn().mockReturnValue(false);
  vi.stubGlobal('confirm', confirm);
  const before = JSON.stringify(project);
  act(() => root.render(<SmartEditPanel editorIntegration project={project} files={files} disabled={false} onApply={onApply} />));
  await act(async () => {
    const select = container.querySelector('[aria-label="AI 任务方式"]') as HTMLSelectElement;
    select.value = 'rebuild';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click(container.querySelector('input[type="checkbox"]')! as HTMLElement);
  await click(button('1. 在本机抽帧（不上传）'));
  await click(button('2. 确认运行 Mock 测试'));
  await click(button('3. 确认替换时间线'));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(onApply).not.toHaveBeenCalled();
  expect(JSON.stringify(project)).toBe(before);
});

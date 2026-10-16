import type { QueueEvent } from 'skyloom-core';
import { createDemoApi } from './demoApi.ts';
import type { BatchOutcome, BatchRequest, ProviderInput, SkyloomApi } from './shared/api.ts';

const api: SkyloomApi = window.skyloom ?? createDemoApi();
const usdText = (micro: number) => `$${(micro / 1e6).toFixed(micro < 1e4 ? 4 : 2)}`;

// Tiny DOM helper. Text always goes through textContent, never innerHTML, so user/provider text cannot inject markup.
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string | boolean | number | ((e: Event) => void) | undefined> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (k === 'class') el.className = String(v);
    else if (k === 'value') (el as HTMLInputElement).value = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  el.append(...kids);
  return el;
}
const field = (label: string, input: HTMLElement, hint?: string) => h('div', { class: 'fld' }, h('label', {}, label), input, ...(hint ? [h('div', { class: 'hint' }, hint)] : []));

const root = document.getElementById('app')!;
let tab: 'batch' | 'providers' = 'batch';

async function render(): Promise<void> {
  const info = await api.info();
  const body = tab === 'batch' ? await batchView() : await providersView(info.mode === 'demo' || info.secureKeys, info.mode === 'demo');
  root.replaceChildren(
    h('div', { class: 'app' },
      h('header', { class: 'top' },
        h('span', { class: 'brand' }, 'Skyloom'),
        h('span', { class: `badge${info.mode === 'demo' ? ' warn' : ''}` }, info.mode === 'demo' ? 'Chạy thử' : 'Máy tính'),
        h('nav', { class: 'tabs', role: 'tablist' },
          ...(['batch', 'providers'] as const).map((t) =>
            h('button', { role: 'tab', 'aria-selected': tab === t, onclick: () => { tab = t; void render(); } }, t === 'batch' ? 'Tạo lô' : 'Nhà cung cấp')))),
      ...(info.note ? [h('div', { class: 'note' }, info.note)] : []),
      body));
}

async function batchView(): Promise<HTMLElement> {
  const ideas = h('textarea', { placeholder: 'Mỗi dòng một ý tưởng, ví dụ:\nSóng biển lúc hoàng hôn, quay chậm\nMở hộp sản phẩm, máy quay từ trên xuống', 'aria-label': 'Danh sách ý tưởng' });
  const dur = h('input', { type: 'number', min: 1, max: 120, value: 8 });
  const aspect = h('select', {}, ...['9:16', '16:9', '1:1'].map((a) => h('option', { value: a }, a)));
  const res = h('select', {}, h('option', { value: '720p' }, '720p'), h('option', { value: '1080p' }, '1080p'));
  const budget = h('input', { type: 'number', min: 0, step: 0.5, value: 1 });
  const strategy = h('select', {}, h('option', { value: 'cheapest' }, 'Rẻ nhất trước'), h('option', { value: 'priority' }, 'Theo thứ tự nhà cung cấp'));
  const expand = h('input', { type: 'checkbox', checked: true });
  const estimateBox = h('div', { class: 'estimate', 'aria-live': 'polite' });
  const list = h('ul', { class: 'items' });
  const summary = h('div', { class: 'summary', 'aria-live': 'polite' });
  const runBtn = h('button', { class: 'btn' }, 'Chạy lô');
  const cancelBtn = h('button', { class: 'btn ghost', disabled: true }, 'Huỷ');
  const estBtn = h('button', { class: 'btn ghost' }, 'Xem báo giá');

  const request = (): BatchRequest => ({
    ideas: ideas.value.split('\n').map((s) => s.trim()).filter(Boolean),
    durationSec: Number((dur as HTMLInputElement).value), aspect: (aspect as HTMLSelectElement).value as BatchRequest['aspect'],
    resolution: (res as HTMLSelectElement).value as BatchRequest['resolution'], expandWithText: (expand as HTMLInputElement).checked,
    budgetUsd: Number((budget as HTMLInputElement).value), strategy: (strategy as HTMLSelectElement).value as BatchRequest['strategy'],
  });
  const rows = new Map<number, { st: HTMLElement; sub: HTMLElement }>();
  const setStatus = (i: number, text: string, cls = '', sub?: string) => {
    const r = rows.get(i); if (!r) return;
    r.st.textContent = text; r.st.className = `st ${cls}`; if (sub !== undefined) r.sub.textContent = sub;
  };
  const jobIndex = (job: string) => Number(job.split('-')[1]);
  const off = api.onEvent((e: QueueEvent) => {
    const i = jobIndex(e.job);
    if (e.type === 'start') setStatus(i, 'Đang chạy…', 'warn', `${e.provider} · lần ${e.attempt}`);
    else if (e.type === 'retry') setStatus(i, `Thử lại sau ${(e.waitMs / 1000).toFixed(1)}s`, 'warn', `${e.provider}: ${e.error}`);
    else if (e.type === 'fallback') setStatus(i, 'Chuyển nhà cung cấp', 'warn', `${e.from}: ${e.error}`);
    else if (e.type === 'done' && e.job.startsWith('video')) setStatus(i, `Xong · ${usdText(e.cost)}`, 'ok', e.provider);
    else if (e.type === 'failed') setStatus(i, 'Lỗi', 'bad', e.error);
  });
  window.addEventListener('pagehide', off, { once: true });

  estBtn.addEventListener('click', async () => {
    const r = await api.estimate(request());
    estimateBox.className = `estimate${r.ok ? '' : ' err'}`;
    estimateBox.textContent = r.ok ? `${r.text}${r.total / 1e6 > request().budgetUsd ? ' — vượt ngân sách, các mục cuối sẽ bị bỏ qua.' : ''}` : r.error;
  });
  runBtn.addEventListener('click', async () => {
    const req = request();
    const est = await api.estimate(req);
    if (!est.ok) { estimateBox.className = 'estimate err'; estimateBox.textContent = est.error; return; }
    estimateBox.className = 'estimate'; estimateBox.textContent = est.text;
    rows.clear(); list.replaceChildren(); summary.textContent = '';
    req.ideas.forEach((idea, i) => {
      const st = h('span', { class: 'st' }, 'Đang chờ'); const sub = h('span', { class: 'sub' });
      rows.set(i, { st, sub }); list.append(h('li', {}, h('span', { class: 'idea', title: idea }, idea), st, sub));
    });
    (runBtn as HTMLButtonElement).disabled = true; (cancelBtn as HTMLButtonElement).disabled = false;
    const out = await api.run(req);
    (runBtn as HTMLButtonElement).disabled = false; (cancelBtn as HTMLButtonElement).disabled = true;
    if ('error' in out) { summary.className = 'summary msg err'; summary.textContent = out.error; return; }
    finish(out);
  });
  cancelBtn.addEventListener('click', () => void api.cancel());

  function finish(out: BatchOutcome): void {
    out.items.forEach((it, i) => {
      if (it.ok) setStatus(i, `Xong · ${usdText(it.costMicro ?? 0)}`, 'ok', `${it.provider}${it.mediaUrl ? ` · ${it.mediaUrl}` : ''}`);
      else setStatus(i, 'Lỗi', 'bad', it.error);
    });
    const ok = out.items.filter((i) => i.ok).length;
    summary.className = 'summary';
    summary.textContent = out.cancelled ? `Đã huỷ. Đã tiêu ${usdText(out.spentMicro)}.` : `${ok}/${out.items.length} thành công. Đã tiêu ${usdText(out.spentMicro)}.${out.outputDir ? ` Đã lưu bản ghi vào ${out.outputDir}` : ''}`;
  }

  return h('div', {},
    h('div', { class: 'card' }, h('h2', {}, 'Ý tưởng'), ideas,
      h('div', { class: 'grid', style: 'margin-top:12px' },
        field('Độ dài (giây)', dur), field('Tỉ lệ', aspect), field('Độ nét', res),
        field('Ngân sách tối đa (USD)', budget, 'Dừng cứng khi chạm trần.'), field('Chọn nhà cung cấp', strategy)),
      h('label', { class: 'check' }, expand, 'Dùng văn bản AI mở rộng mỗi ý tưởng thành mô tả cảnh quay trước'),
      h('div', { class: 'row' }, estBtn, runBtn, cancelBtn), estimateBox),
    h('div', { class: 'card' }, h('h2', {}, 'Tiến độ'), list, summary));
}

async function providersView(secureKeys: boolean, demo: boolean): Promise<HTMLElement> {
  const list = await api.listProviders();
  const msg = h('div', { class: 'msg', 'aria-live': 'polite' });
  const f = {
    kind: h('select', {}, h('option', { value: 'openai-compat-text' }, 'Văn bản (chat-completions)'), h('option', { value: 'fal-video' }, 'Video (fal.ai)')),
    usdPerSecond: h('input', { type: 'number', min: 0, step: 'any', placeholder: 'USD cho mỗi giây video' }),
    extra: h('textarea', { rows: 3, placeholder: '{"tham_số": "giá trị"} (tuỳ chọn)' }),
    id: h('input', { placeholder: 'vd: nvidia-text' }), label: h('input', { placeholder: 'Tên hiển thị' }),
    baseUrl: h('input', { placeholder: 'https://…/v1 (fal: để trống = mặc định)' }), model: h('input', { placeholder: 'Tên model' }),
    key: h('input', { type: 'password', autocomplete: 'off', placeholder: 'Khoá API của bạn' }),
    rpm: h('input', { type: 'number', min: 1, placeholder: 'vd: 40' }),
    pin: h('input', { type: 'number', min: 0, step: 'any', placeholder: '0 nếu miễn phí' }), pout: h('input', { type: 'number', min: 0, step: 'any', placeholder: '0 nếu miễn phí' }),
  };
  const num = (el: HTMLInputElement) => (el.value === '' ? undefined : Number(el.value));
  const save = h('button', { class: 'btn' }, 'Lưu nhà cung cấp');
  const textOnly = [f.pin, f.pout];
  const videoOnly = [f.usdPerSecond, f.extra];
  const syncKind = () => {
    const video = f.kind.value === 'fal-video';
    for (const el of textOnly) el.closest('.fld')!.toggleAttribute('hidden', video);
    for (const el of videoOnly) el.closest('.fld')!.toggleAttribute('hidden', !video);
  };
  f.kind.addEventListener('change', syncKind);
  save.addEventListener('click', async () => {
    let extraInput: Record<string, unknown> | undefined;
    if (f.kind.value === 'fal-video' && f.extra.value.trim()) {
      try { extraInput = JSON.parse(f.extra.value) as Record<string, unknown>; } catch { msg.className = 'msg err'; msg.textContent = 'Tham số bổ sung không phải JSON hợp lệ.'; return; }
    }
    const video = f.kind.value === 'fal-video';
    const p: ProviderInput = {
      id: f.id.value.trim(), label: f.label.value.trim(), kind: video ? 'fal-video' : 'openai-compat-text', baseUrl: f.baseUrl.value.trim(), model: f.model.value.trim(), apiKey: f.key.value,
      ...(num(f.rpm) !== undefined ? { rpm: num(f.rpm)! } : {}), ...(!video && num(f.pin) !== undefined ? { usdPerMillionIn: num(f.pin)! } : {}), ...(!video && num(f.pout) !== undefined ? { usdPerMillionOut: num(f.pout)! } : {}),
      ...(video && num(f.usdPerSecond) !== undefined ? { usdPerSecond: num(f.usdPerSecond)! } : {}), ...(extraInput ? { extraInput } : {}),
    };
    const r = await api.saveProvider(p);
    f.key.value = ''; // never keep the key in the page after sending it
    if (!r.ok) { msg.className = 'msg err'; msg.textContent = r.error; return; }
    tab = 'providers'; void render();
  });
  const wrap = h('div', {},
    ...(secureKeys ? [] : [h('div', { class: 'note' }, 'Máy này chưa có kho khoá an toàn của hệ điều hành, nên ứng dụng sẽ không lưu khoá API.')]),
    h('div', { class: 'card' }, h('h2', {}, 'Nhà cung cấp đã thêm'),
      list.length === 0 ? h('div', { class: 'hint' }, 'Chưa có nhà cung cấp nào.') :
        h('table', {}, h('tbody', {}, ...list.map((p) => h('tr', {}, h('td', {}, p.label), h('td', {}, p.kind === 'fal-video' ? 'video' : 'văn bản'), h('td', {}, p.model), h('td', {}, p.baseUrl),
          h('td', {}, h('button', { class: 'btn ghost', onclick: async () => { await api.removeProvider(p.id); void render(); } }, 'Xoá')))))),
      h('div', { class: 'hint', style: 'margin-top:10px' }, 'Khoá API được gửi một lần tới tiến trình chính, mã hoá bằng kho khoá hệ điều hành và không bao giờ đọc ngược lại ra giao diện.')),
    h('div', { class: 'card' }, h('h2', {}, 'Thêm nhà cung cấp'),
      h('div', { class: 'grid' }, field('Loại', f.kind), field('Mã', f.id), field('Tên', f.label), field('Địa chỉ API', f.baseUrl, 'Phải là https.'), field('Model', f.model, 'fal: mã endpoint của model, lấy từ trang model.'), field('Khoá API', f.key),
        field('Giới hạn request/phút', f.rpm), field('Giá vào (USD/1M token)', f.pin), field('Giá ra (USD/1M token)', f.pout),
        field('Giá mỗi giây video (USD)', f.usdPerSecond, 'Lấy từ trang giá của model; app dùng số này để báo giá và giữ trần ngân sách.'),
        field('Tham số bổ sung (JSON)', f.extra, 'Tham số riêng của model, gộp vào request. Mặc định app gửi prompt, duration, aspect_ratio, resolution.')),
      h('div', { class: 'row' }, save), msg),
    h('div', { class: 'note' }, list.some((p) => p.kind === 'fal-video') ? 'Đã có nhà cung cấp video. Tên tham số và dạng kết quả khác nhau theo từng model fal: hãy chạy thử một lô nhỏ trước.' : demo ? 'Chưa có nhà cung cấp video. Chế độ chạy thử dùng nhà cung cấp giả để bạn xem trọn luồng.' : 'Chưa có nhà cung cấp video nên chưa chạy được lô thật. Hãy thêm một nhà cung cấp loại "Video (fal.ai)".'));
  syncKind();
  return wrap;
}

void render();

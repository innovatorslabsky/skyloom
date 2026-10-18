import { FAL_PRESETS } from 'skyloom-core';
import { MAX_IDEAS_FILE_BYTES, parseIdeasFile } from './ideas.ts';
import type { QueueEvent } from 'skyloom-core';
import { createDemoApi } from './demoApi.ts';
import { createWebApi } from './webApi.ts';
import type { BatchOutcome, BatchRequest, ProviderInput, SkyloomApi } from './shared/api.ts';

const webMode = document.querySelector('meta[name="skyloom-mode"]')?.getAttribute('content') === 'web'; // set by the web server
const api: SkyloomApi = window.skyloom ?? (webMode ? createWebApi() : createDemoApi());
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
let tab: 'batch' | 'providers' | 'history' = 'batch';

async function render(): Promise<void> {
  const info = await api.info();
  const body = tab === 'batch' ? await batchView() : tab === 'history' ? await historyView(info.mode === 'demo') : await providersView(info.mode === 'demo' || info.secureKeys, info.mode === 'demo');
  root.replaceChildren(
    h('div', { class: 'app' },
      h('header', { class: 'top' },
        h('span', { class: 'brand' }, 'Skyloom'),
        h('span', { class: `badge${info.mode === 'demo' ? ' warn' : ''}` }, info.mode === 'demo' ? 'Chạy thử' : info.mode === 'web' ? 'Web' : 'Máy tính'),
        h('nav', { class: 'tabs', role: 'tablist' },
          ...(['batch', 'history', 'providers'] as const).map((t) =>
            h('button', { role: 'tab', 'aria-selected': tab === t, onclick: () => { tab = t; void render(); } }, t === 'batch' ? 'Tạo lô' : t === 'history' ? 'Lịch sử' : 'Nhà cung cấp'))),
        ...(api.logout ? [h('button', { class: 'btn ghost', onclick: () => void api.logout!() }, 'Đăng xuất')] : [])),
      ...(info.note ? [h('div', { class: 'note' }, info.note)] : []),
      body));
}

async function batchView(): Promise<HTMLElement> {
  const ideas = h('textarea', { placeholder: 'Mỗi dòng một ý tưởng, ví dụ:\nSóng biển lúc hoàng hôn, quay chậm\nMở hộp sản phẩm, máy quay từ trên xuống', 'aria-label': 'Danh sách ý tưởng' });
  const fileNote = h('div', { class: 'hint', 'aria-live': 'polite' });
  const fileInput = h('input', { type: 'file', accept: '.txt,.csv,text/plain,text/csv', hidden: true });
  /** Add the ideas from a dropped/picked .txt or .csv to the box (existing text is kept). */
  const importFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    if (!/\.(txt|csv)$/i.test(file.name)) { fileNote.textContent = 'Chỉ nhận file .txt hoặc .csv.'; return; }
    if (file.size > MAX_IDEAS_FILE_BYTES) { fileNote.textContent = 'File lớn hơn 1 MB.'; return; }
    const r = parseIdeasFile(file.name, await file.text());
    if (r.ideas.length > 0) ideas.value = [ideas.value.trimEnd(), ...r.ideas].filter(Boolean).join('\n');
    fileNote.textContent = [`Đã thêm ${r.ideas.length} ý tưởng từ ${file.name}.`, ...r.notes].join(' ');
  };
  fileInput.addEventListener('change', () => { void importFile(fileInput.files?.[0]); fileInput.value = ''; });
  ideas.addEventListener('dragover', (e) => e.preventDefault());
  ideas.addEventListener('drop', (e) => { e.preventDefault(); void importFile(e.dataTransfer?.files[0]); });
  const mode = h('select', {}, h('option', { value: 'video' }, 'Video'), h('option', { value: 'image' }, 'Ảnh'));
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
    mode: (mode as HTMLSelectElement).value as 'video' | 'image',
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
      if (it.ok) setStatus(i, `Xong · ${usdText(it.costMicro ?? 0)}`, 'ok', `${it.provider}${it.file ? ` · đã lưu ${it.file}` : it.downloadError ? ` · không tải được: ${it.downloadError}` : it.mediaUrl ? ` · ${it.mediaUrl}` : ''}`);
      else setStatus(i, 'Lỗi', 'bad', it.error);
    });
    const ok = out.items.filter((i) => i.ok).length;
    summary.className = 'summary';
    summary.textContent = out.cancelled ? `Đã huỷ. Đã tiêu ${usdText(out.spentMicro)}.` : `${ok}/${out.items.length} thành công. Đã tiêu ${usdText(out.spentMicro)}.${out.outputDir ? (webMode ? ' Xem file trong tab Lịch sử.' : ` Đã lưu bản ghi vào ${out.outputDir}`) : ''}`;
  }

  const view = h('div', {},
    h('div', { class: 'card' }, h('h2', {}, 'Ý tưởng'), ideas,
      h('div', { class: 'row' }, h('label', { class: 'btn ghost filebtn' }, 'Nhập từ file .txt / .csv', fileInput), fileNote),
      h('div', { class: 'grid mt12' },
        field('Tạo', mode), field('Độ dài (giây)', dur), field('Tỉ lệ', aspect), field('Độ nét', res),
        field('Ngân sách tối đa (USD)', budget, 'Dừng cứng khi chạm trần.'), field('Chọn nhà cung cấp', strategy)),
      h('label', { class: 'check' }, expand, 'Dùng văn bản AI mở rộng mỗi ý tưởng thành mô tả cảnh quay trước'),
      h('div', { class: 'row' }, estBtn, runBtn, cancelBtn), estimateBox),
    h('div', { class: 'card' }, h('h2', {}, 'Tiến độ'), list, summary));
  // Stills have no duration or resolution, and "expand with text" is only about prompts, so it stays available.
  const syncMode = () => { const image = (mode as HTMLSelectElement).value === 'image'; for (const el of [dur, res]) el.closest('.fld')!.toggleAttribute('hidden', image); };
  mode.addEventListener('change', syncMode);
  syncMode();
  return view;
}

/** Small preview of a saved result; loaded only when scrolled to (video preload=none), same-origin only. */
function mediaPreview(src: string): HTMLElement {
  return /\.(mp4|webm|mov)$/i.test(src) ? h('video', { src, controls: true, preload: 'none', class: 'preview' }) : h('img', { src, loading: 'lazy', alt: '', class: 'preview' });
}

async function historyView(demo: boolean): Promise<HTMLElement> {
  const runs = await api.listHistory();
  if (runs.length === 0) return h('div', { class: 'card' }, h('h2', {}, 'Lịch sử'), h('div', { class: 'hint' }, 'Chưa có lô nào. Mỗi lô đã chạy sẽ hiện ở đây.'));
  return h('div', {}, ...runs.map((r) => h('div', { class: 'card' },
    h('h2', {}, new Date(r.createdAt).toLocaleString('vi-VN')),
    h('div', { class: 'hint' }, `${r.okCount}/${r.count} thành công · đã tiêu ${usdText(r.spentMicro)}${r.cancelled ? ' · đã huỷ' : ''}`),
    h('details', {}, h('summary', {}, 'Chi tiết'),
      h('ul', { class: 'items' }, ...r.items.map((it) => h('li', {}, h('span', { class: 'idea', title: it.idea }, it.idea),
        h('span', { class: `st ${it.ok ? 'ok' : 'bad'}` }, it.ok ? `Xong${it.costMicro !== undefined ? ` · ${usdText(it.costMicro)}` : ''}` : 'Lỗi'),
        h('span', { class: 'sub' }, ...(it.file && api.mediaUrl ? [h('a', { href: api.mediaUrl(r.id, it.file), target: '_blank', rel: 'noopener' }, it.file)] : [it.file ?? it.error ?? it.provider ?? ''])),
        ...(it.file && api.mediaUrl ? [mediaPreview(api.mediaUrl(r.id, it.file))] : []))))),
    ...(demo || webMode ? [] : [h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: () => void api.openHistory(r.id) }, 'Mở thư mục'))]))));
}

async function providersView(secureKeys: boolean, demo: boolean): Promise<HTMLElement> {
  const list = await api.listProviders();
  const msg = h('div', { class: 'msg', 'aria-live': 'polite' });
  const f = {
    kind: h('select', {}, h('option', { value: 'openai-compat-text' }, 'Văn bản (chat-completions)'), h('option', { value: 'fal-video' }, 'Video (fal.ai)'), h('option', { value: 'gemini-omni-video' }, 'Video (Gemini Omni)'), h('option', { value: 'fal-image' }, 'Ảnh (fal.ai)')),
    pmp: h('input', { type: 'number', min: 0, step: 'any', placeholder: 'USD/megapixel (để trống = giá niêm yết của flux/schnell)' }),
    fixed: h('input', { type: 'number', min: 1, step: 'any', placeholder: 'tuỳ chọn, vd: 10' }),
    preset: h('select', {}, h('option', { value: '' }, 'Tuỳ chỉnh (dạng request chung)'), ...FAL_PRESETS.map((x) => h('option', { value: x.id }, x.label))),
    usdPerSecond: h('input', { type: 'number', min: 0, step: 'any', placeholder: 'USD/giây (để trống = giá niêm yết của mẫu fal)' }),
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
  const syncKind = () => {
    const k = f.kind.value;
    const show = (el: HTMLElement, on: boolean) => el.closest('.fld')!.toggleAttribute('hidden', !on);
    show(f.preset, k === 'fal-video');
    show(f.fixed, k === 'gemini-omni-video');
    show(f.usdPerSecond, k === 'fal-video' || k === 'gemini-omni-video');
    show(f.pmp, k === 'fal-image');
    show(f.extra, k !== 'openai-compat-text');
    for (const el of textOnly) show(el, k === 'openai-compat-text');
  };
  f.kind.addEventListener('change', syncKind);
  f.preset.addEventListener('change', () => {
    const x = FAL_PRESETS.find((q) => q.id === f.preset.value);
    if (x) f.model.value = x.model; // suggestion only: the user can still edit it (e.g. standard → pro)
  });
  save.addEventListener('click', async () => {
    let extraInput: Record<string, unknown> | undefined;
    if (f.kind.value !== 'openai-compat-text' && f.extra.value.trim()) {
      try { extraInput = JSON.parse(f.extra.value) as Record<string, unknown>; } catch { msg.className = 'msg err'; msg.textContent = 'Tham số bổ sung không phải JSON hợp lệ.'; return; }
    }
    const video = f.kind.value === 'fal-video' || f.kind.value === 'gemini-omni-video';
    const p: ProviderInput = {
      id: f.id.value.trim(), label: f.label.value.trim(), kind: f.kind.value as ProviderInput['kind'], baseUrl: f.baseUrl.value.trim(), model: f.model.value.trim(), apiKey: f.key.value,
      ...(num(f.rpm) !== undefined ? { rpm: num(f.rpm)! } : {}), ...(f.kind.value === 'openai-compat-text' && num(f.pin) !== undefined ? { usdPerMillionIn: num(f.pin)! } : {}), ...(f.kind.value === 'openai-compat-text' && num(f.pout) !== undefined ? { usdPerMillionOut: num(f.pout)! } : {}),
      ...(f.kind.value === 'fal-video' && f.preset.value ? { preset: f.preset.value } : {}), ...(f.kind.value === 'gemini-omni-video' && num(f.fixed) !== undefined ? { fixedSeconds: num(f.fixed)! } : {}), ...(video && num(f.usdPerSecond) !== undefined ? { usdPerSecond: num(f.usdPerSecond)! } : {}), ...(f.kind.value === 'fal-image' && num(f.pmp) !== undefined ? { usdPerMegapixel: num(f.pmp)! } : {}), ...(extraInput ? { extraInput } : {}),
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
        h('table', {}, h('tbody', {}, ...list.map((p) => h('tr', {}, h('td', {}, p.label), h('td', {}, p.kind === 'openai-compat-text' ? 'văn bản' : p.kind === 'fal-image' ? 'ảnh' : 'video'), h('td', {}, p.model), h('td', {}, p.baseUrl),
          h('td', {}, h('button', { class: 'btn ghost', onclick: async () => { await api.removeProvider(p.id); void render(); } }, 'Xoá')))))),
      h('div', { class: 'hint mt10' }, 'Khoá API được gửi một lần tới tiến trình chính, mã hoá bằng kho khoá hệ điều hành và không bao giờ đọc ngược lại ra giao diện.')),
    h('div', { class: 'card' }, h('h2', {}, 'Thêm nhà cung cấp'),
      h('div', { class: 'grid' }, field('Loại', f.kind), field('Mã', f.id), field('Tên', f.label), field('Địa chỉ API', f.baseUrl, 'Phải là https.'), field('Model', f.model, 'fal: mã endpoint của model, lấy từ trang model.'), field('Khoá API', f.key),
        field('Giới hạn request/phút', f.rpm), field('Giá vào (USD/1M token)', f.pin), field('Giá ra (USD/1M token)', f.pout),
        field('Mẫu model video', f.preset, 'Mẫu quyết định tên tham số và độ dài hỗ trợ. Chọn mẫu sẽ điền gợi ý vào ô Model.'), field('Số giây tính tiền mỗi clip', f.fixed, 'Chỉ khi model luôn làm clip cùng độ dài: app dùng số này để báo giá và giữ trần ngân sách.'), field('Giá mỗi megapixel ảnh (USD)', f.pmp, 'fal flux/schnell: $0.003 mỗi megapixel (niêm yết 17/10/2026) nên có thể để trống; model khác phải tự nhập. Ảnh 576×1024 ≈ 0,59 megapixel.'), field('Giá mỗi giây video (USD)', f.usdPerSecond, 'App dùng số này để báo giá và giữ trần ngân sách. Với mẫu fal (Kling v3 Standard tắt âm thanh: $0.084; Wan 2.7: $0.10 ở 720p, $0.15 ở 1080p) có thể để trống để dùng giá niêm yết; nếu đổi model hoặc bật âm thanh thì phải tự nhập.'),
        field('Tham số bổ sung (JSON)', f.extra, 'Tham số riêng của model, gộp vào request. Mặc định app gửi prompt, duration, aspect_ratio, resolution.')),
      h('div', { class: 'row' }, save), msg),
    h('div', { class: 'note' }, list.some((p) => p.kind !== 'openai-compat-text') ? 'Đã có nhà cung cấp video. Tên tham số và dạng kết quả khác nhau theo từng model: hãy chạy thử một lô nhỏ trước. Gemini Omni nhận tỉ lệ (9:16 hoặc 16:9) và độ nét từ lô, nhưng không cho chọn độ dài clip: ô "độ dài" chỉ dùng để báo giá, nên hãy điền "Số giây tính tiền mỗi clip" theo độ dài thực tế bạn thấy.' : demo ? 'Chưa có nhà cung cấp video. Chế độ chạy thử dùng nhà cung cấp giả để bạn xem trọn luồng.' : 'Chưa có nhà cung cấp video nên chưa chạy được lô thật. Hãy thêm một nhà cung cấp loại "Video (fal.ai)" hoặc "Video (Gemini Omni)".'));
  syncKind();
  return wrap;
}

void render();

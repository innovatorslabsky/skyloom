/** Largest file we will read into the page, bytes. */
export const MAX_IDEAS_FILE_BYTES = 1024 * 1024;
export const MAX_IDEAS = 500;
export const MAX_IDEA_CHARS = 2000;

export interface ParsedIdeas { ideas: string[]; notes: string[] }

/** Minimal RFC 4180 reader: quoted fields may hold commas, doubled quotes and line breaks. Accepts ',' or ';' or tab as separator. */
export function parseCsv(text: string, sep = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

const HEADER = /^(prompt|prompts|idea|ideas|ý tưởng|mô tả|mo ta|description|text)$/i;
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

function guessSeparator(firstLine: string): string {
  const counts: Array<[string, number]> = [[',', 0], [';', 0], ['\t', 0]];
  let q = false;
  for (const ch of firstLine) { if (ch === '"') q = !q; else if (!q) for (const c of counts) if (c[0] === ch) c[1]++; }
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ',';
}

/**
 * Turn the text of a .txt or .csv file into batch ideas. .txt: one idea per line. .csv: the column named like "prompt"/"idea" if the
 * first row is a header, otherwise the first column. Line breaks inside an idea become spaces (the batch box is one idea per line).
 * Over-long ideas are skipped and over-large lists are cut, each with a note, so nothing is dropped silently.
 */
export function parseIdeasFile(name: string, raw: string): ParsedIdeas {
  const notes: string[] = [];
  const text = raw.replace(/^﻿/, '');
  let cells: string[];
  if (/\.csv$/i.test(name)) {
    const rows = parseCsv(text, guessSeparator(text.split(/\r?\n/, 1)[0] ?? ''));
    let col = 0;
    let start = 0;
    const head = rows[0];
    if (head && head.some((c) => HEADER.test(c.trim()))) {
      col = Math.max(0, head.findIndex((c) => HEADER.test(c.trim())));
      start = 1;
      notes.push(`Đã bỏ dòng tiêu đề, dùng cột "${head[col]!.trim()}".`);
    }
    cells = rows.slice(start).map((r) => r[col] ?? '');
  } else {
    cells = text.split(/\r?\n/);
  }
  let ideas = cells.map(clean).filter(Boolean);
  const tooLong = ideas.filter((i) => i.length > MAX_IDEA_CHARS).length;
  if (tooLong) { ideas = ideas.filter((i) => i.length <= MAX_IDEA_CHARS); notes.push(`Bỏ ${tooLong} ý tưởng dài hơn ${MAX_IDEA_CHARS} ký tự.`); }
  if (ideas.length > MAX_IDEAS) { notes.push(`Chỉ lấy ${MAX_IDEAS} ý tưởng đầu, bỏ ${ideas.length - MAX_IDEAS} ý tưởng còn lại.`); ideas = ideas.slice(0, MAX_IDEAS); }
  if (ideas.length === 0) notes.push('Không tìm thấy ý tưởng nào trong file.');
  return { ideas, notes };
}

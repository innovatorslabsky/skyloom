import { describe, expect, it } from 'vitest';
import { MAX_IDEAS, parseCsv, parseIdeasFile } from '../src/ideas.ts';

describe('parseIdeasFile .txt', () => {
  it('one idea per line, trims, drops blanks, handles CRLF and BOM', () => {
    expect(parseIdeasFile('a.txt', '﻿  Sóng biển \r\n\r\n  Mở hộp\n').ideas).toEqual(['Sóng biển', 'Mở hộp']);
  });
  it('says so when the file is empty', () => {
    expect(parseIdeasFile('a.txt', '\n \n').notes).toEqual(['Không tìm thấy ý tưởng nào trong file.']);
  });
});

describe('parseIdeasFile .csv', () => {
  it('reads quoted fields with commas, doubled quotes and line breaks (flattened to one line)', () => {
    const csv = 'prompt\n"A cat, a dog"\n"She said ""hi""\nand left"\nplain\n';
    expect(parseIdeasFile('x.csv', csv).ideas).toEqual(['A cat, a dog', 'She said "hi" and left', 'plain']);
  });
  it('uses the named column when there is a header, else the first column', () => {
    expect(parseIdeasFile('x.csv', 'id,prompt,notes\n1,Biển,x\n2,Núi,y').ideas).toEqual(['Biển', 'Núi']);
    expect(parseIdeasFile('x.csv', 'Biển,1\nNúi,2').ideas).toEqual(['Biển', 'Núi']);
  });
  it('detects ; and tab separators (common in Excel exports)', () => {
    expect(parseIdeasFile('x.csv', 'id;ý tưởng\n1;Biển\n2;Núi').ideas).toEqual(['Biển', 'Núi']);
    expect(parseIdeasFile('x.csv', 'idea\tn\nBiển\t1').ideas).toEqual(['Biển']);
  });
  it('a header-looking first cell is dropped with a note', () => {
    const r = parseIdeasFile('x.csv', 'Idea\nA\nB');
    expect(r.ideas).toEqual(['A', 'B']);
    expect(r.notes[0]).toMatch(/tiêu đề/);
  });
  it('does not treat a comma inside quotes as a separator when guessing', () => {
    expect(parseIdeasFile('x.csv', '"a;b,c"\n"d"').ideas).toEqual(['a;b,c', 'd']);
  });
});

describe('limits', () => {
  it('skips over-long ideas and caps the list, each with a note', () => {
    const r = parseIdeasFile('a.txt', ['x'.repeat(2001), ...Array.from({ length: MAX_IDEAS + 3 }, (_, i) => `i${i}`)].join('\n'));
    expect(r.ideas).toHaveLength(MAX_IDEAS);
    expect(r.notes.join(' ')).toMatch(/dài hơn 2000/);
    expect(r.notes.join(' ')).toMatch(/bỏ 3/);
  });
  it('parseCsv keeps a final unterminated row and empty cells', () => {
    expect(parseCsv('a,,c\nd')).toEqual([['a', '', 'c'], ['d']]);
  });
});

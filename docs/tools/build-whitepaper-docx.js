// Builds the Waylix white paper .docx from docs/WHITEPAPER.md (small purpose-built markdown parser).
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, LevelFormat, Header, Footer, PageNumber, PageBreak, TabStopType,
} = require('docx');

const SRC = process.argv[2];
const OUT = process.argv[3];
const md = fs.readFileSync(SRC, 'utf8').split('\n');

const BODY = 'Cambria';
const HEAD = 'Calibri';
const BRAND = '0B5FFF';
const INK = '0F172A';
const SOFT = '475569';
const PAGE_W = 11906, MARGIN = 1300; // A4
const CONTENT_W = PAGE_W - 2 * MARGIN;

// Inline: **bold**, *italic*, `code`
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const t = m[0];
    if (t.startsWith('**')) out.push(new TextRun({ text: t.slice(2, -2), bold: true, ...base }));
    else if (t.startsWith('`')) out.push(new TextRun({ text: t.slice(1, -1), font: 'Consolas', size: (base.size || 22) - 2, ...base, }));
    else out.push(new TextRun({ text: t.slice(1, -1), italics: true, ...base }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out;
}

const children = [];
const border = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };

function table(rows) {
  const cells = rows.map((r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  const header = cells[0];
  const body = cells.slice(2);
  const n = header.length;
  const first = n === 2 ? Math.round(CONTENT_W * 0.36) : Math.round(CONTENT_W / n);
  const widths = n === 2 ? [first, CONTENT_W - first] : Array(n).fill(Math.floor(CONTENT_W / n));
  widths[n - 1] = CONTENT_W - widths.slice(0, -1).reduce((a, b) => a + b, 0);
  const total = body.length + 1;
  let rowNo = 0;
  const mk = (row, isHead) => { const keep = ++rowNo < total; return new TableRow({
    tableHeader: isHead,
    cantSplit: true,
    children: row.map((c, i) => new TableCell({
      width: { size: widths[i], type: WidthType.DXA },
      borders: { top: border, bottom: border, left: border, right: border },
      shading: isHead ? { type: ShadingType.CLEAR, fill: 'E8EEFF', color: 'auto' } : undefined,
      margins: { top: 70, bottom: 70, left: 110, right: 110 },
      children: [new Paragraph({ keepNext: keep, keepLines: true, spacing: { before: 0, after: 0, line: 260 }, children: runs(c, { size: 19, bold: isHead || undefined, font: isHead ? HEAD : BODY }) })],
    })),
  }); };
  children.push(new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths, rows: [mk(header, true), ...body.map((r) => mk(r, false))] }));
  children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
}

// ── Cover block from the first lines ────────────────────────────────────
let i = 0;
const title = md[0].replace(/^#\s+/, '');
const subtitle = md.find((l) => l.startsWith('### ')).replace(/^###\s+/, '');
const metaLine = md.find((l) => l.startsWith('**AIDotLix White Paper')).replace(/\*\*/g, '');
const authorLine = md.find((l) => l.startsWith('Author:'));
children.push(
  new Paragraph({ spacing: { before: 600, after: 0 }, children: [new TextRun({ text: 'AIDotLix  ·  WHITE PAPER', font: HEAD, size: 20, bold: true, color: BRAND, characterSpacing: 40 })] }),
  new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title })] }),
  new Paragraph({ spacing: { before: 0, after: 240 }, children: [new TextRun({ text: subtitle, font: HEAD, size: 28, color: SOFT })] }),
  new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BRAND, space: 6 } }, spacing: { after: 160 }, children: [] }),
  new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: metaLine, font: HEAD, size: 20, color: SOFT })] }),
  new Paragraph({ spacing: { after: 360 }, children: [new TextRun({ text: authorLine, font: HEAD, size: 20, color: SOFT })] }),
);
// skip to first '---'
while (i < md.length && md[i].trim() !== '---') i++;
i++;

let inRefs = false;
let listInstance = 0;
let prevWasNum = false;
for (; i < md.length; i++) {
  const line = md[i];
  const t = line.trim();
  if (!t) continue;
  const isNum = /^\d+\.\s+/.test(t);
  if (isNum && !prevWasNum) listInstance++;
  prevWasNum = isNum;
  if (t === '---') continue;
  if (t.startsWith('## ')) {
    const text = t.slice(3);
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text })] }));
    continue;
  }
  if (t.startsWith('### ')) {
    const text = t.slice(4);
    inRefs = /^References/.test(text);
    children.push(new Paragraph({ heading: inRefs ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, children: [new TextRun({ text })] }));
    continue;
  }
  if (t.startsWith('|')) {
    const rows = [];
    while (i < md.length && md[i].trim().startsWith('|')) rows.push(md[i++].trim());
    i--;
    table(rows);
    continue;
  }
  if (t === '$$') {
    const eq = [];
    i++;
    while (md[i].trim() !== '$$') eq.push(md[i++].trim());
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 160, after: 160 },
      shading: { type: ShadingType.CLEAR, fill: 'F1F5F9', color: 'auto' },
      children: [new TextRun({ text: 'logit P(h)  =  β₀  +  Σ', font: 'Cambria Math', size: 26 }), new TextRun({ text: '  over e ∈ L(h):', font: 'Cambria Math', size: 22, italics: true }), new TextRun({ text: '  sₑ · wₑ · T(ρₑ) · 2', font: 'Cambria Math', size: 26 }), new TextRun({ text: '−Δtₑ/τ', font: 'Cambria Math', size: 20, superScript: true })],
    }));
    continue;
  }
  if (t.startsWith('> ')) {
    children.push(new Paragraph({
      spacing: { before: 80, after: 160 }, indent: { left: 400, right: 400 },
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: BRAND, space: 10 } },
      children: runs(t.slice(2), { size: 20, color: INK }),
    }));
    continue;
  }
  if (t.startsWith('- ')) {
    children.push(new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 80 }, children: runs(t.slice(2)) }));
    continue;
  }
  const num = /^(\d+)\.\s+(.*)$/.exec(t);
  if (num) {
    if (inRefs) {
      children.push(new Paragraph({ spacing: { after: 70 }, indent: { left: 420, hanging: 420 }, children: [new TextRun({ text: `[${num[1]}]\t`, size: 19 }), ...runs(num[2], { size: 19 })], tabStops: [{ type: TabStopType.LEFT, position: 420 }] }));
    } else {
      children.push(new Paragraph({ numbering: { reference: 'numbers', level: 0, instance: listInstance }, spacing: { after: 80 }, children: runs(num[2]) }));
    }
    continue;
  }
  if (t.startsWith('*©')) {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 360 }, children: [new TextRun({ text: t.replace(/^\*|\*$/g, ''), italics: true, size: 18, color: SOFT })] }));
    continue;
  }
  // Abstract / keywords paragraphs get a little emphasis
  children.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, keepNext: t.endsWith(':') || /\(σ = [\d.]+ m, from Table 1\)\.$/.test(t), spacing: { after: 120, line: 288 }, children: runs(t) }));
}

const doc = new Document({
  creator: 'Mahlori Lloyd Chauke — AIDotLix',
  title: `${title}: ${subtitle}`,
  description: 'AIDotLix White Paper WP-2026-03 — Waylix and the Hazard Fusion Engine',
  styles: {
    default: { document: { run: { font: BODY, size: 22, color: INK } } },
    paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { font: HEAD, size: 60, bold: true, color: INK }, paragraph: { spacing: { before: 120, after: 80 }, keepNext: true } },
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: HEAD, size: 30, bold: true, color: BRAND }, paragraph: { spacing: { before: 320, after: 120 }, keepNext: true, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: HEAD, size: 25, bold: true, color: INK }, paragraph: { spacing: { before: 220, after: 80 }, keepNext: true, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
      { reference: 'numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] },
    ],
  },
  sections: [{
    properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: 1300, bottom: 1300, left: MARGIN, right: MARGIN } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'Waylix White Paper  ·  AIDotLix', font: HEAD, size: 16, color: SOFT })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: HEAD, size: 18, color: SOFT })] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then((b) => { fs.writeFileSync(OUT, b); console.log('wrote', OUT); });

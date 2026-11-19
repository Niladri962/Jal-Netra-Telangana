// CSV / PDF export helpers. Every export is stamped as simulated data.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const SIM_STAMP = 'SIMULATED DATA — JalNetra demonstration environment. Not government data.';

export function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [`# ${SIM_STAMP}`, cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export function download(name: string, content: string | Blob, type = 'text/csv') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCSV(name: string, rows: Record<string, unknown>[]) {
  download(name, toCSV(rows));
}

export function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  if (lines.length < 2) return [];
  const split = (l: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (q) {
        if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const head = split(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((l) => {
    const cells = split(l);
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']));
  });
}

export interface PdfSection {
  heading: string;
  text?: string[];
  table?: { head: string[]; body: (string | number)[][] };
}

export function downloadPDF(name: string, title: string, subtitle: string, sections: PdfSection[]) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(10, 22, 48);
  doc.rect(0, 0, W, 70, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(title, 36, 32);
  doc.setFontSize(9);
  doc.setTextColor(170, 200, 230);
  doc.text(subtitle, 36, 50);
  doc.setTextColor(200, 60, 200);
  doc.text(SIM_STAMP, 36, 62);
  let y = 92;
  doc.setTextColor(20, 20, 20);
  for (const s of sections) {
    if (y > 760) { doc.addPage(); y = 50; }
    doc.setFontSize(12);
    doc.setTextColor(13, 80, 120);
    doc.text(s.heading, 36, y);
    y += 14;
    doc.setFontSize(9);
    doc.setTextColor(40, 40, 40);
    for (const t of s.text ?? []) {
      const lines = doc.splitTextToSize(t, W - 72);
      if (y + lines.length * 11 > 800) { doc.addPage(); y = 50; }
      doc.text(lines, 36, y);
      y += lines.length * 11 + 3;
    }
    if (s.table) {
      autoTable(doc, { startY: y, head: [s.table.head], body: s.table.body, styles: { fontSize: 7.5, cellPadding: 3 }, headStyles: { fillColor: [17, 36, 73] }, margin: { left: 36, right: 36 } });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;
    }
    y += 6;
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(130, 130, 130);
    doc.text(`JalNetra · ${SIM_STAMP} · page ${i}/${pages}`, 36, 828);
  }
  doc.save(name);
}

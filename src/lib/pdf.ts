import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { STATUS_COLOUR, type TicketStatus } from "@/lib/types";

export interface PdfTicket {
  competency: string;
  section: string;
  expiry: string | null; // null => "No expiry"
  status: string;
  cardType: string | null;
  frontDataUrl?: string | null;
  backDataUrl?: string | null;
}

export interface PdfOperative {
  name: string;
  role: string;
  tickets: PdfTicket[];
}

const INK = "#1c1a17";
const BRASS = "#9a7b3f";
const ADDRESS = "Fortuna Civils · S63 9HN";

/** Build a branded multi-page PDF — one operative per page. Returns the jsPDF doc. */
export function buildOperativePdf(operatives: PdfOperative[]): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const issued = new Date().toISOString().slice(0, 10);

  operatives.forEach((op, idx) => {
    if (idx > 0) doc.addPage();

    // Header bar
    doc.setFillColor(INK);
    doc.rect(0, 0, pageW, 22, "F");
    doc.setTextColor("#f6f3ec");
    doc.setFont("times", "normal");
    doc.setFontSize(15);
    doc.text("Fortuna Civils — Register of Competency", 14, 14);
    doc.setFillColor(BRASS);
    doc.rect(0, 22, pageW, 0.8, "F");

    // Name + role
    doc.setTextColor(INK);
    doc.setFont("times", "bold");
    doc.setFontSize(18);
    doc.text(op.name, 14, 34);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor("#6b6356");
    doc.text(op.role, 14, 41);

    // Tickets table (held only)
    const body = op.tickets.map((t) => [
      t.section,
      t.competency + (t.cardType ? `  (${t.cardType})` : ""),
      t.expiry ?? "No expiry",
      statusLabel(t.status),
    ]);

    autoTable(doc, {
      startY: 47,
      head: [["Section", "Competency", "Expiry", "Status"]],
      body: body.length ? body : [["—", "No held tickets", "—", "—"]],
      theme: "grid",
      styles: { font: "helvetica", fontSize: 9, cellPadding: 2, textColor: INK },
      headStyles: { fillColor: [28, 26, 23], textColor: [246, 243, 236] },
      alternateRowStyles: { fillColor: [246, 243, 236] },
      margin: { left: 14, right: 14 },
      didDrawPage: () => drawFooter(doc, pageW, pageH, issued),
    });

    // Card images (front/back) for tickets that have them.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let y = ((doc as any).lastAutoTable?.finalY ?? 47) + 8;
    const imgW = 70;
    const imgH = 44;
    const withImages = op.tickets.filter((t) => t.frontDataUrl || t.backDataUrl);
    if (withImages.length) {
      doc.setFont("times", "bold");
      doc.setFontSize(12);
      doc.setTextColor(INK);
      if (y > pageH - 20) {
        doc.addPage();
        drawFooter(doc, pageW, pageH, issued);
        y = 20;
      }
      doc.text("Card evidence", 14, y);
      y += 6;
      for (const t of withImages) {
        if (y + imgH + 10 > pageH - 16) {
          doc.addPage();
          drawFooter(doc, pageW, pageH, issued);
          y = 20;
        }
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor("#6b6356");
        doc.text(t.competency, 14, y);
        y += 3;
        try {
          if (t.frontDataUrl)
            doc.addImage(t.frontDataUrl, fmt(t.frontDataUrl), 14, y, imgW, imgH);
          if (t.backDataUrl)
            doc.addImage(t.backDataUrl, fmt(t.backDataUrl), 14 + imgW + 6, y, imgW, imgH);
        } catch {
          /* malformed image — skip */
        }
        y += imgH + 8;
      }
    }
  });

  return doc;
}

function fmt(dataUrl: string): "PNG" | "JPEG" {
  return dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
}

function statusLabel(s: string): string {
  const key = s as TicketStatus;
  return STATUS_COLOUR[key]?.label ?? s;
}

function drawFooter(doc: jsPDF, pageW: number, pageH: number, issued: string) {
  doc.setDrawColor("#cfc8ba");
  doc.line(14, pageH - 14, pageW - 14, pageH - 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor("#6b6356");
  doc.text(`Issued ${issued}`, 14, pageH - 9);
  doc.text(ADDRESS, pageW / 2, pageH - 9, { align: "center" });
  // Colour key
  const key = "● In date   ▲ Expiring   — No expiry";
  doc.text(key, pageW - 14, pageH - 9, { align: "right" });
}

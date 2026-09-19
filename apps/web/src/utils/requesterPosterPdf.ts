import { jsPDF } from "jspdf";

interface PosterPdfInput {
  requesterUrl: string;
  qrDataUrl: string;
  logoDataUrl: string;
}

function loadAssetDataUrl(url: string) {
  return fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error("Unable to load the company logo.");
      return response.blob();
    })
    .then((blob) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Unable to read the company logo."));
      reader.readAsDataURL(blob);
    }));
}

export function createRequesterPosterPdf({ requesterUrl, qrDataUrl, logoDataUrl }: PosterPdfInput) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const maroon = "#7f111b";
  const darkMaroon = "#3f0710";
  const brass = "#d2a85b";
  const ink = "#2f2730";
  const muted = "#716870";

  pdf.setFillColor(darkMaroon);
  pdf.rect(0, 0, 210, 64, "F");
  pdf.setFillColor(maroon);
  pdf.circle(196, 2, 54, "F");
  pdf.setFillColor(brass);
  pdf.rect(0, 61, 210, 3, "F");
  pdf.addImage(logoDataUrl, "PNG", 18, 12, 72, 26, undefined, "FAST");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text("MAINTENANCE COMMAND", 18, 51);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text("PUBLIC WORK ORDER REQUEST", 148, 51, { align: "center" });

  pdf.setTextColor(ink);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(25);
  pdf.text("Need maintenance help?", 105, 84, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(muted);
  pdf.setFontSize(12);
  pdf.text("Scan the QR code and send a work order from your phone.", 105, 94, { align: "center" });

  pdf.setDrawColor(228, 219, 221);
  pdf.setFillColor(255, 255, 255);
  pdf.roundedRect(49, 105, 112, 112, 5, 5, "FD");
  pdf.addImage(qrDataUrl, "PNG", 57, 113, 96, 96, undefined, "FAST");

  pdf.setFillColor(249, 244, 245);
  pdf.roundedRect(18, 229, 174, 36, 4, 4, "F");
  const steps = [
    ["1", "SCAN", "Open your camera"],
    ["2", "CHOOSE", "Office, Maintenance, Project or Kaizen"],
    ["3", "SUBMIT", "Add details and a photo"]
  ];
  steps.forEach(([number, title, detail], index) => {
    const x = 24 + index * 57;
    pdf.setFillColor(maroon);
    pdf.circle(x + 5, 240, 5, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text(number, x + 5, 243, { align: "center" });
    pdf.setTextColor(ink);
    pdf.setFontSize(8.5);
    pdf.text(title, x + 12, 239);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(muted);
    pdf.setFontSize(7.5);
    pdf.text(pdf.splitTextToSize(detail, 43), x + 12, 245);
  });

  pdf.setTextColor(maroon);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text("NO LOGIN REQUIRED", 105, 277, { align: "center" });
  pdf.setTextColor(muted);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  const displayUrl = requesterUrl.length > 82 ? `${requesterUrl.slice(0, 79)}...` : requesterUrl;
  pdf.text(displayUrl, 105, 284, { align: "center", maxWidth: 174 });
  pdf.setDrawColor(brass);
  pdf.line(70, 289, 140, 289);
  pdf.setFontSize(7);
  pdf.text("Pangan Berkah Sentosa SDN BHD", 105, 294, { align: "center" });
  return pdf;
}

export async function downloadRequesterPosterPdf(requesterUrl: string, qrDataUrl: string) {
  const logoDataUrl = await loadAssetDataUrl("/brand/sugi_mark_white.png");
  createRequesterPosterPdf({ requesterUrl, qrDataUrl, logoDataUrl }).save("pbs-cmms-Work-Order-QR-Poster.pdf");
}

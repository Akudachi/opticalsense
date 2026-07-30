import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Clinic, Patient, Test } from "@/types";
import { formatDateTime, formatDate, formatDuration, calcAge } from "./format";

type Args = {
  test: Test;
  patient: Patient;
  clinic: Clinic;
};

/** Generates a clinic-branded PDF report and triggers download. */
export async function generateReportPdf({ test, patient, clinic }: Args): Promise<void> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;

  // Header
  doc.setFillColor(59, 107, 214);
  doc.rect(0, 0, pageW, 78, "F");
  doc.setTextColor(255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(clinic.name, margin, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(clinic.address, margin, 50);
  doc.text(`${clinic.phone}  ·  ${clinic.email}`, margin, 64);
  doc.setFontSize(9);
  doc.text("OpticalSense · Optical Pulp Vitality Report", pageW - margin, 34, { align: "right" });
  doc.text(`Generated ${formatDateTime(new Date().toISOString())}`, pageW - margin, 50, { align: "right" });

  // Body
  doc.setTextColor(20);
  let y = 110;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Pulp Vitality Assessment", margin, y);
  y += 22;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Report ID: OS-${test.id.slice(-8).toUpperCase()}`, margin, y);
  y += 20;

  autoTable(doc, {
    startY: y,
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 4 },
    head: [["Patient", "Details"]],
    headStyles: { fillColor: [239, 244, 253], textColor: 30, fontStyle: "bold" },
    body: [
      ["Name", patient.fullName],
      ["Age / Sex", `${calcAge(patient.dateOfBirth)} yrs · ${patient.sex}`],
      ["Date of birth", formatDate(patient.dateOfBirth)],
      ["Phone", patient.phone],
      ["Email", patient.email ?? "—"],
      ["Tooth of interest (FDI)", test.toothOfInterest ?? patient.toothOfInterest ?? "—"],
    ],
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;

  autoTable(doc, {
    startY: y,
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 4 },
    head: [["Test", "Value"]],
    headStyles: { fillColor: [239, 244, 253], textColor: 30, fontStyle: "bold" },
    body: [
      ["Started", formatDateTime(test.startedAt)],
      ["Duration", formatDuration(test.summary.durationSec)],
      ["Device", test.deviceId],
      ["Avg SpO₂", `${test.summary.avgSpO2} %`],
      ["Avg Pulse", `${test.summary.avgPulse} bpm`],
      ["Avg Temperature", `${test.summary.avgTemp} °C`],
      ["Min SpO₂ / Max Pulse", `${test.summary.minSpO2} % · ${test.summary.maxPulse} bpm`],
      ["Signal Quality", `${test.summary.signalQuality} / 100`],
      ["Measurement Confidence", test.summary.confidence.toUpperCase()],
    ],
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;

  // Waveform sketch
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Heart rate waveform (normalized)", margin, y);
  y += 8;
  const boxW = pageW - margin * 2;
  const boxH = 80;
  doc.setDrawColor(220);
  doc.setLineWidth(0.5);
  doc.rect(margin, y, boxW, boxH);
  const s = test.samples;
  if (s.length > 1) {
    const values = s.map((x) => x.heartRate);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    doc.setDrawColor(59, 107, 214);
    doc.setLineWidth(0.9);
    const step = boxW / (s.length - 1);
    let px = margin;
    let py = y + boxH - ((s[0].heartRate - min) / range) * (boxH - 8) - 4;
    for (let i = 1; i < s.length; i++) {
      const nx = margin + i * step;
      const ny = y + boxH - ((s[i].heartRate - min) / range) * (boxH - 8) - 4;
      doc.line(px, py, nx, ny);
      px = nx;
      py = ny;
    }
  }
  y += boxH + 20;

  // Verdict block
  const verdictLabel: Record<Test["pulpVerdict"], string> = {
    vital: "Pulp response consistent with VITAL tissue.",
    non_vital: "Findings suggest NON-VITAL pulp — clinical correlation advised.",
    inconclusive: "Result INCONCLUSIVE — recommend repeat capture with improved probe contact.",
  };
  doc.setFillColor(239, 244, 253);
  doc.roundedRect(margin, y, pageW - margin * 2, 46, 6, 6, "F");
  doc.setTextColor(30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Clinical verdict", margin + 12, y + 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(verdictLabel[test.pulpVerdict], margin + 12, y + 34);
  y += 66;

  // Observations
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Observations", margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const wrap = doc.splitTextToSize(test.observations || "No observations recorded.", pageW - margin * 2);
  doc.text(wrap, margin, y);
  y += wrap.length * 12 + 24;

  // Signature
  doc.setDrawColor(180);
  doc.setLineWidth(0.5);
  doc.line(margin, y, margin + 200, y);
  doc.setFontSize(9);
  doc.text(clinic.doctorName, margin, y + 12);
  doc.text(clinic.licenseNo ? `Lic. ${clinic.licenseNo}` : "Attending clinician", margin, y + 24);

  // Footer
  const footerY = doc.internal.pageSize.getHeight() - 24;
  doc.setFontSize(8);
  doc.setTextColor(140);
  doc.text("Generated by OpticalSense · Optical Pulp Vitality Monitoring System", margin, footerY);

  doc.save(`OpticalSense-Report-${test.id.slice(-8).toUpperCase()}.pdf`);
}

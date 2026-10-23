import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Clinic, Patient, Report, Test } from "@/types";
import { formatDateTime, formatDate, calcAge } from "./format";

type Args = {
  test: Test;
  patient: Patient;
  clinic: Clinic;
  report?: Report;
};

/** Generates a clinic-branded PDF report using the frozen running averages since 20s. */
export async function generateReportPdf({ test, patient, clinic, report }: Args): Promise<void> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;

  const reading = report?.reading ?? test.reportReading;
  const isValid = reading?.valid ?? (test.valid && (reading?.spo2 ?? 0) > 0);

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
  doc.text(`Generated ${formatDateTime(report?.generatedAt || new Date().toISOString())}`, pageW - margin, 50, { align: "right" });

  // Body
  doc.setTextColor(20);
  let y = 110;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Dental Pulp Vitality Assessment", margin, y);
  y += 22;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Report ID: OS-${(report?.id || test.id).slice(-8).toUpperCase()}`, margin, y);
  y += 20;

  // Patient Info Table
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

  // Test Reading Table (Using running averages since 20s; no warm-up /result averages)
  const readingRows = isValid && reading
    ? [
        ["Test Started", formatDateTime(test.startedAt)],
        ["Assessment Protocol", "Continuous running averages since 20s stabilization"],
        ["Valid Readings", `${reading.validReadings ?? 5} samples collected`],
        ["Device ID", test.deviceId],
        ["SpO₂ (Running Average)", `${reading.spo2.toFixed(1)} %`],
        ["Pulse / Heart Rate (Running Average)", `${Math.round(reading.heartRate)} bpm`],
        ["Temperature (Running Average)", `${reading.temperature.toFixed(2)} °C`],
        ["Signal Quality (Running Average)", `${Math.round(reading.signalQuality)} / 100`],
        ["Vitality Status", reading.vitalityStatus || "Vital"],
      ]
    : [
        ["Test Started", formatDateTime(test.startedAt)],
        ["Device ID", test.deviceId],
        ["Assessment Status", "INVALID"],
        ["Clinical Notice", "Not enough valid readings. Keep the probe steady and run the test longer."],
      ];

  autoTable(doc, {
    startY: y,
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 4 },
    head: [["Assessment Parameter (Continuous Summary)", "Value"]],
    headStyles: { fillColor: [239, 244, 253], textColor: 30, fontStyle: "bold" },
    body: readingRows,
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;

  // 20-second interval breakdown table (if multiple intervals recorded)
  const intervals = reading?.intervalReadings;
  if (isValid && intervals && intervals.length > 0) {
    const intervalRows = intervals.map((inv) => [
      inv.timeWindowLabel,
      inv.spo2 > 0 ? `${inv.spo2}%` : "Stabilising",
      inv.heartRate > 0 ? `${inv.heartRate} bpm` : "--",
      inv.temperature > 0 ? `${inv.temperature.toFixed(2)} °C` : "--",
      inv.signalQuality > 0 ? `${inv.signalQuality}%` : "--",
      inv.vitalityStatus,
    ]);

    autoTable(doc, {
      startY: y,
      theme: "plain",
      styles: { fontSize: 8.5, cellPadding: 3 },
      head: [["20s Interval", "SpO₂", "Pulse", "Temp", "Signal", "Status"]],
      headStyles: { fillColor: [239, 244, 253], textColor: 30, fontStyle: "bold" },
      body: intervalRows,
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
  } else {
    y += 4;
  }

  // Verdict block
  if (isValid && reading) {
    const statusLower = (reading.vitalityStatus || "").toLowerCase();
    const verdictText = statusLower.includes("non")
      ? "Findings suggest NON-VITAL pulp — clinical correlation advised."
      : statusLower.includes("vital")
      ? "Pulp response consistent with VITAL tissue."
      : "Result INCONCLUSIVE — recommend repeat capture with improved probe contact.";

    doc.setFillColor(239, 244, 253);
    doc.roundedRect(margin, y, pageW - margin * 2, 46, 6, 6, "F");
    doc.setTextColor(30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Clinical Verdict (Post-20s Stabilized Averages)", margin + 12, y + 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(verdictText, margin + 12, y + 34);
    y += 66;
  } else {
    doc.setFillColor(254, 243, 199);
    doc.roundedRect(margin, y, pageW - margin * 2, 46, 6, 6, "F");
    doc.setTextColor(146, 64, 14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Reading Notice", margin + 12, y + 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Not enough valid readings. Keep the probe steady and run the test longer.", margin + 12, y + 34);
    y += 66;
  }

  // Observations
  doc.setTextColor(30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Observations", margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const obsText = test.observations || "Continuous post-20s optical measurement acquired successfully.";
  const wrap = doc.splitTextToSize(obsText, pageW - margin * 2);
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

  doc.save(`OpticalSense-Report-${(report?.id || test.id).slice(-8).toUpperCase()}.pdf`);
}

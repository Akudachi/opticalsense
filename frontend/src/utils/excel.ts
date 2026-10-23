import * as XLSX from "xlsx";
import type { Clinic, Patient, Report, Test } from "@/types";
import { formatDateTime } from "./format";

type Args = {
  test: Test;
  patient: Patient;
  clinic: Clinic;
  report?: Report;
};

/**
 * Generates an Excel report using the frozen running averages since 20 seconds.
 * Warm-up samples (< 20s) and /result device-wide averages are excluded per firmware v3.7.0 rules.
 */
export async function generateReportExcel({ test, patient, clinic, report }: Args): Promise<void> {
  const reading = report?.reading ?? test.reportReading;
  const isValid = reading?.valid ?? (test.valid && (reading?.spo2 ?? 0) > 0);

  // Create workbook
  const workbook = XLSX.utils.book_new();

  const sensorData: (string | number)[][] = [
    ["OpticalSense - Dental Pulp Vitality Assessment Report"],
    [""],
    ["Clinic", clinic.name],
    ["Clinician", clinic.doctorName],
    ["Patient Name", patient.fullName],
    ["Tooth of Interest (FDI)", test.toothOfInterest ?? patient.toothOfInterest ?? "—"],
    ["Device ID", test.deviceId],
    ["Test Started", formatDateTime(test.startedAt)],
    ["Test Ended", test.endedAt ? formatDateTime(test.endedAt) : ""],
    ["Assessment Protocol", "Continuous running averages calculated strictly from 20 seconds onward"],
    [""],
  ];

  if (isValid && reading) {
    sensorData.push([
      "Timestamp",
      "Valid Readings Count",
      "Heart Rate Average (bpm)",
      "SpO₂ Average (%)",
      "Temperature Average (°C)",
      "Signal Quality Average",
      "Vitality Status",
      "Vitality Index",
    ]);

    sensorData.push([
      reading.timestamp,
      reading.validReadings ?? 5,
      reading.heartRate,
      reading.spo2,
      reading.temperature,
      reading.signalQuality,
      reading.vitalityStatus || "Vital",
      reading.vitalityIndex !== undefined ? reading.vitalityIndex : "",
    ]);
  } else {
    sensorData.push([
      "Reading Status",
      "Details",
    ]);
    sensorData.push([
      "INVALID",
      "Not enough valid readings. Keep the probe steady and run the test longer.",
    ]);
  }

  const sensorSheet = XLSX.utils.aoa_to_sheet(sensorData);
  XLSX.utils.book_append_sheet(workbook, sensorSheet, "Vitality Assessment");

  // Generate and download
  XLSX.writeFile(workbook, `OpticalSense-Report-${test.id.slice(-8).toUpperCase()}.xlsx`);
}

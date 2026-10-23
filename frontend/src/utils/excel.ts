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
 * Generates an Excel report using ONLY the stabilized reading taken after the first 20 seconds.
 * Earlier readings and 5-second intervals are omitted per firmware v3.7.0 requirements.
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
    ["Assessment Protocol", "Stabilized optical reading taken after first 20 seconds"],
    [""],
  ];

  if (isValid && reading) {
    const readingTimeSec = (reading.testDuration / 1000).toFixed(1);
    sensorData.push([
      "Timestamp",
      "Stabilization Time (sec)",
      "Heart Rate (bpm)",
      "SpO₂ (%)",
      "Temperature (°C)",
      "Signal Quality",
      "Vitality Status",
      "Vitality Index",
    ]);

    sensorData.push([
      reading.timestamp,
      readingTimeSec,
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
      "No valid reading after 20 s. Retry and keep the probe steady.",
    ]);
  }

  const sensorSheet = XLSX.utils.aoa_to_sheet(sensorData);
  XLSX.utils.book_append_sheet(workbook, sensorSheet, "Vitality Assessment");

  // Generate and download
  XLSX.writeFile(workbook, `OpticalSense-Report-${test.id.slice(-8).toUpperCase()}.xlsx`);
}

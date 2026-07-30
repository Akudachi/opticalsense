import * as XLSX from "xlsx";
import type { Clinic, Patient, Test } from "@/types";
import { formatDateTime } from "./format";

type Args = {
  test: Test;
  patient: Patient;
  clinic: Clinic;
};

/** Generates an Excel report with 5-second interval sampling and triggers download. */
export async function generateReportExcel({ test, patient, clinic }: Args): Promise<void> {
  // Sample data every 5 seconds (assuming 10 Hz sampling rate = 50 samples per 5 seconds)
  const samplingInterval = 50; // 5 seconds at 10 Hz
  const sampledData = test.samples.filter((_, index) => index % samplingInterval === 0);

  // Create workbook
  const workbook = XLSX.utils.book_new();

  // Summary sheet
  const summaryData = [
    ["OpticalSense - Optical Pulp Vitality Report"],
    [""],
    ["Clinic Information"],
    ["Clinic Name", clinic.name],
    ["Doctor", clinic.doctorName],
    ["Address", clinic.address],
    ["Phone", clinic.phone],
    ["Email", clinic.email],
    [""],
    ["Patient Information"],
    ["Name", patient.fullName],
    ["Date of Birth", patient.dateOfBirth],
    ["Phone", patient.phone],
    ["Email", patient.email || ""],
    ["Tooth of Interest", test.toothOfInterest || patient.toothOfInterest || ""],
    [""],
    ["Test Information"],
    ["Test ID", test.id],
    ["Device ID", test.deviceId],
    ["Started", formatDateTime(test.startedAt)],
    ["Ended", test.endedAt ? formatDateTime(test.endedAt) : ""],
    ["Duration (seconds)", test.summary.durationSec],
    ["Status", test.status],
    [""],
    ["Test Summary"],
    ["Average SpO₂ (%)", test.summary.avgSpO2],
    ["Average Pulse (bpm)", test.summary.avgPulse],
    ["Average Temperature (°C)", test.summary.avgTemp],
    ["Minimum SpO₂ (%)", test.summary.minSpO2],
    ["Maximum Pulse (bpm)", test.summary.maxPulse],
    ["Signal Quality", test.summary.signalQuality],
    ["Confidence", test.summary.confidence],
    ["Pulp Verdict", test.pulpVerdict],
    ["Observations", test.observations || ""],
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  // Detailed data sheet with 5-second interval sampling
  const detailedData = [
    [
      "Timestamp",
      "Heart Rate (bpm)",
      "SpO₂ (%)",
      "Temperature (°C)",
      "Battery (%)",
      "Signal Quality",
      "Vitality Index",
      "Vitality Status",
      "Probe Quality",
      "Device State",
    ],
  ];

  sampledData.forEach((sample) => {
    detailedData.push([
      sample.timestamp,
      String(sample.heartRate),
      String(sample.spo2),
      String(sample.temperature),
      String(sample.battery),
      String(sample.signalQuality),
      sample.vitalityIndex !== undefined ? String(sample.vitalityIndex) : "",
      sample.vitalityStatus || "",
      sample.probeQuality || "",
      sample.deviceState || "",
    ]);
  });

  const detailedSheet = XLSX.utils.aoa_to_sheet(detailedData);
  XLSX.utils.book_append_sheet(workbook, detailedSheet, "Sensor Data (5s interval)");

  // Generate and download
  XLSX.writeFile(workbook, `OpticalSense-Report-${test.id.slice(-8).toUpperCase()}.xlsx`);
}

import * as XLSX from "xlsx";
import type { Clinic, Patient, Test } from "@/types";
import { formatDateTime } from "./format";

type Args = {
  test: Test;
  patient: Patient;
  clinic: Clinic;
};

/** Generates an Excel report with 5-second interval sensor readings and triggers download. */
export async function generateReportExcel({ test, patient, clinic }: Args): Promise<void> {
  // Sample data every 5 seconds (assuming 10 Hz sampling rate = 50 samples per 5 seconds)
  const samplingInterval = 50; // 5 seconds at 10 Hz
  const sampledData = test.samples.filter((_, index) => index % samplingInterval === 0);

  // Create workbook
  const workbook = XLSX.utils.book_new();

  // Sensor data sheet with 5-second interval sampling
  const sensorData = [
    ["OpticalSense - Sensor Data Report"],
    [""],
    ["Test ID", test.id],
    ["Patient Name", patient.fullName],
    ["Device ID", test.deviceId],
    ["Test Started", formatDateTime(test.startedAt)],
    ["Test Ended", test.endedAt ? formatDateTime(test.endedAt) : ""],
    ["Duration (seconds)", test.summary.durationSec],
    [""],
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
    sensorData.push([
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

  const sensorSheet = XLSX.utils.aoa_to_sheet(sensorData);
  XLSX.utils.book_append_sheet(workbook, sensorSheet, "Sensor Data");

  // Generate and download
  XLSX.writeFile(workbook, `OpticalSense-SensorData-${test.id.slice(-8).toUpperCase()}.xlsx`);
}

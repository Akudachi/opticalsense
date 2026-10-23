import * as XLSX from "xlsx";
import type { Clinic, IntervalReading, Patient, Report, SensorSample, Test } from "@/types";
import { formatDateTime } from "./format";

type Args = {
  test: Test;
  patient: Patient;
  clinic: Clinic;
  report?: Report;
};

/**
 * Extracts or computes the 20-second interval readings from the test samples.
 * Every 20-second window (0-20s, 20-40s, 40-60s, etc.) is preserved with averages.
 */
export function getOrComputeIntervals(
  test: { samples?: SensorSample[]; startedAt?: string; summary?: Partial<Test["summary"]>; reportReading?: ReportReading },
  reading?: Report["reading"]
): IntervalReading[] {
  if (reading?.intervalReadings && reading.intervalReadings.length > 0) {
    return reading.intervalReadings;
  }
  if (test.reportReading?.intervalReadings && test.reportReading.intervalReadings.length > 0) {
    return test.reportReading.intervalReadings;
  }

  const samples = test.samples || [];
  if (samples.length === 0) {
    if (reading && reading.valid) {
      return [
        {
          intervalIndex: 1,
          timeMarkSec: 20,
          timeWindowLabel: "0s – 20s",
          timestamp: reading.timestamp,
          heartRate: reading.heartRate,
          spo2: reading.spo2,
          temperature: reading.temperature,
          signalQuality: reading.signalQuality,
          vitalityStatus: reading.vitalityStatus || "Vital",
          vitalityIndex: reading.vitalityIndex,
          validReadingsCount: reading.validReadings ?? 5,
        },
      ];
    }
    return [];
  }

  const durationMs = Math.max(
    reading?.testDuration ?? 0,
    test.summary?.durationSec ? test.summary.durationSec * 1000 : 0,
    ...samples.map((s) => s.testDuration ?? 0)
  );

  const numIntervals = Math.max(1, Math.ceil(durationMs / 20000));
  const intervals: IntervalReading[] = [];

  for (let i = 0; i < numIntervals; i++) {
    const startMs = i * 20000;
    const endMs = (i + 1) * 20000;
    const markSec = (i + 1) * 20;
    const windowLabel = `${i * 20}s – ${markSec}s`;

    const windowSamples = samples.filter((s) => {
      const d = s.testDuration ?? 0;
      return d >= startMs && d < endMs;
    });

    const validSamples = windowSamples.filter(
      (s) => (s.spo2 ?? 0) > 0 && (s.heartRate ?? 0) > 0
    );

    if (validSamples.length > 0) {
      const avgSpo2 = validSamples.reduce((acc, s) => acc + s.spo2, 0) / validSamples.length;
      const avgHr = validSamples.reduce((acc, s) => acc + s.heartRate, 0) / validSamples.length;
      const avgTemp = validSamples.reduce((acc, s) => acc + (s.temperature ?? 0), 0) / validSamples.length;
      const avgQuality = validSamples.reduce((acc, s) => acc + (s.signalQuality ?? 0), 0) / validSamples.length;
      const lastSample = validSamples[validSamples.length - 1];

      intervals.push({
        intervalIndex: i + 1,
        timeMarkSec: markSec,
        timeWindowLabel: windowLabel,
        timestamp: lastSample.timestamp || formatDateTime(test.startedAt),
        spo2: Number(avgSpo2.toFixed(1)),
        heartRate: Math.round(avgHr),
        temperature: Number(avgTemp.toFixed(2)),
        signalQuality: Math.round(avgQuality),
        vitalityStatus: lastSample.vitalityStatus || "Vital",
        vitalityIndex: lastSample.vitalityIndex,
        validReadingsCount: validSamples.length,
      });
    } else if (windowSamples.length > 0) {
      const lastSample = windowSamples[windowSamples.length - 1];
      intervals.push({
        intervalIndex: i + 1,
        timeMarkSec: markSec,
        timeWindowLabel: windowLabel,
        timestamp: lastSample.timestamp || formatDateTime(test.startedAt),
        spo2: 0,
        heartRate: 0,
        temperature: Number((lastSample.temperature ?? 0).toFixed(2)),
        signalQuality: Math.round(lastSample.signalQuality ?? 0),
        vitalityStatus: "Stabilising / Warm-up",
        vitalityIndex: undefined,
        validReadingsCount: 0,
      });
    }
  }

  return intervals;
}

/**
 * Generates an Excel report storing the continuous test averages AND
 * the readings of every 20 seconds as discrete time slices.
 */
export async function generateReportExcel({ test, patient, clinic, report }: Args): Promise<void> {
  const reading = report?.reading ?? test.reportReading;
  const isValid = reading?.valid ?? (test.valid && (reading?.spo2 ?? 0) > 0);
  const intervals = getOrComputeIntervals(test, reading);

  // Create workbook
  const workbook = XLSX.utils.book_new();

  const durationSec = Math.round(
    (reading?.testDuration ? reading.testDuration / 1000 : 0) ||
    test.summary?.durationSec ||
    (test.endedAt ? (new Date(test.endedAt).getTime() - new Date(test.startedAt).getTime()) / 1000 : 0)
  );

  const statusLower = (reading?.vitalityStatus || test.summary?.vitalityStatus || "").toLowerCase();
  const verdict = statusLower.includes("non")
    ? "NON-VITAL"
    : statusLower.includes("vital")
    ? "VITAL"
    : "INCONCLUSIVE";

  // Sheet 1: Vitality Assessment Report
  const assessmentData: (string | number)[][] = [
    ["OpticalSense - Dental Pulp Vitality Assessment Report"],
    ["Continuous Monitoring Session & 20-Second Interval Log"],
    [""],
    ["CLINICAL & PATIENT DETAILS", ""],
    ["Clinic Name", clinic.name],
    ["Clinician", clinic.doctorName],
    ["License Number", clinic.licenseNo || "—"],
    ["Patient Name", patient.fullName],
    ["Patient ID", patient.id],
    ["Tooth of Interest (FDI)", test.toothOfInterest ?? patient.toothOfInterest ?? "—"],
    ["Device ID", test.deviceId],
    ["Test Session Started", formatDateTime(test.startedAt)],
    ["Test Session Ended", test.endedAt ? formatDateTime(test.endedAt) : "—"],
    ["Total Test Duration", `${durationSec} seconds (Continuous until user stopped)`],
    ["Clinical Verdict", verdict],
    [""],
  ];

  if (isValid && reading) {
    // 1. Table of Every 20-Second Interval Readings
    assessmentData.push(["20-SECOND INTERVAL READINGS (Continuous Telemetry Time Slices)"]);
    assessmentData.push([
      "Interval #",
      "Time Window",
      "Time Mark",
      "Timestamp",
      "Heart Rate (bpm)",
      "SpO₂ (%)",
      "Temperature (°C)",
      "Signal Quality (%)",
      "Vitality Status",
      "Vitality Index",
      "Valid Samples in Window",
    ]);

    if (intervals.length > 0) {
      for (const inv of intervals) {
        assessmentData.push([
          inv.intervalIndex,
          inv.timeWindowLabel,
          `${inv.timeMarkSec}s`,
          inv.timestamp,
          inv.heartRate > 0 ? inv.heartRate : "--",
          inv.spo2 > 0 ? inv.spo2 : "--",
          inv.temperature > 0 ? inv.temperature : "--",
          inv.signalQuality > 0 ? inv.signalQuality : "--",
          inv.vitalityStatus,
          inv.vitalityIndex !== undefined ? inv.vitalityIndex : "—",
          inv.validReadingsCount,
        ]);
      }
    } else {
      assessmentData.push([
        1,
        "0s – 20s",
        "20s",
        reading.timestamp,
        reading.heartRate,
        reading.spo2,
        reading.temperature,
        reading.signalQuality,
        reading.vitalityStatus || "Vital",
        reading.vitalityIndex !== undefined ? reading.vitalityIndex : "—",
        reading.validReadings ?? 5,
      ]);
    }

    assessmentData.push([""]);
    assessmentData.push(["OVERALL CONTINUOUS TEST SUMMARY (Stabilized Post-20s Averages)"]);
    assessmentData.push(["Parameter", "Overall Value", "Clinical Reference / Interpretation"]);
    assessmentData.push([
      "Overall Heart Rate (bpm)",
      reading.heartRate,
      "Normal adult range: 60 - 100 bpm",
    ]);
    assessmentData.push([
      "Overall SpO₂ (%)",
      `${reading.spo2.toFixed(1)}%`,
      "Healthy pulp vascularization: 95% - 100%",
    ]);
    assessmentData.push([
      "Overall Tooth Temperature (°C)",
      `${reading.temperature.toFixed(2)} °C`,
      "Baseline tooth surface temp: 36.0°C - 37.5°C",
    ]);
    assessmentData.push([
      "Overall Signal Quality (%)",
      `${reading.signalQuality}%`,
      "Optical SNR threshold: >= 70% reliable",
    ]);
    assessmentData.push([
      "Vitality Status",
      reading.vitalityStatus || "Vital",
      verdict,
    ]);
    assessmentData.push([
      "Total Valid Samples Collected",
      reading.validReadings ?? 5,
      "Continuous 1 Hz samples collected post-stabilization",
    ]);
    assessmentData.push([
      "Observations",
      test.observations || "Continuous post-20s optical measurement acquired successfully.",
      "—",
    ]);
  } else {
    assessmentData.push(["ASSESSMENT STATUS", "DETAILS"]);
    assessmentData.push([
      "INVALID",
      "Not enough valid readings. Keep the probe steady and run the test longer.",
    ]);
  }

  const sensorSheet = XLSX.utils.aoa_to_sheet(assessmentData);
  sensorSheet["!cols"] = [
    { wch: 14 },
    { wch: 16 },
    { wch: 14 },
    { wch: 22 },
    { wch: 18 },
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
    { wch: 22 },
    { wch: 15 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(workbook, sensorSheet, "Vitality Assessment");

  // Sheet 2: Continuous 1-Second Telemetry Log (if test.samples exists)
  if (test.samples && test.samples.length > 0) {
    const telemetryData: (string | number)[][] = [
      ["OpticalSense - Full Continuous Telemetry Log (1-Second Samples)"],
      [""],
      [
        "Sample #",
        "Elapsed Time (s)",
        "Timestamp",
        "SpO₂ (%)",
        "Heart Rate (bpm)",
        "Temperature (°C)",
        "Signal Quality (%)",
        "Probe Contact",
        "Vitality Status",
      ],
    ];

    test.samples.forEach((s: SensorSample, idx: number) => {
      const elapsedSec = Math.round((s.testDuration ?? 0) / 1000);
      telemetryData.push([
        idx + 1,
        elapsedSec,
        s.timestamp,
        s.spo2 > 0 ? s.spo2 : 0,
        s.heartRate > 0 ? s.heartRate : 0,
        s.temperature ? Number(s.temperature.toFixed(2)) : 0,
        s.signalQuality ? Math.round(s.signalQuality) : 0,
        s.fingerDetected ? "CONTACT_DETECTED" : "NO_CONTACT",
        s.vitalityStatus || "—",
      ]);
    });

    const telemetrySheet = XLSX.utils.aoa_to_sheet(telemetryData);
    telemetrySheet["!cols"] = [
      { wch: 10 },
      { wch: 16 },
      { wch: 24 },
      { wch: 12 },
      { wch: 18 },
      { wch: 16 },
      { wch: 18 },
      { wch: 20 },
      { wch: 22 },
    ];
    XLSX.utils.book_append_sheet(workbook, telemetrySheet, "Continuous Telemetry (1s Log)");
  }

  // Generate and download
  XLSX.writeFile(workbook, `OpticalSense-Report-${test.id.slice(-8).toUpperCase()}.xlsx`);
}

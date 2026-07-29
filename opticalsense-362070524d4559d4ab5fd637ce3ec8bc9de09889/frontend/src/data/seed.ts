import type { ActivityEvent, Clinic, Device, Patient, Report, SensorSample, Test } from "@/types";

const CLINIC_ID = "clinic_northlake";
const DOCTOR_ID = "user_dr_kaur";

export const seedClinic: Clinic = {
  id: CLINIC_ID,
  name: "Northlake Dental Institute",
  doctorName: "Dr. Priya Kaur, DDS",
  address: "184 Harbour Street, Suite 4B, Vancouver BC V6C 1H2",
  phone: "+1 (604) 555-0148",
  email: "clinic@northlakedental.ca",
  licenseNo: "BC-DDS-48219",
};

const patientSeed: Array<Omit<Patient, "id" | "createdAt" | "updatedAt" | "clinicId">> = [
  { fullName: "Amelia Chen", dateOfBirth: "1988-04-12", sex: "female", phone: "+1 604 555 0121", email: "amelia.chen@example.com", medicalNotes: "History of thermal sensitivity on upper right quadrant. No systemic conditions.", toothOfInterest: "16" },
  { fullName: "Marcus Whitfield", dateOfBirth: "1974-11-30", sex: "male", phone: "+1 604 555 0132", email: "m.whitfield@example.com", medicalNotes: "Prior root canal on #26. Referred for vitality reassessment of #27.", toothOfInterest: "27" },
  { fullName: "Sofía Alvarez", dateOfBirth: "1995-02-08", sex: "female", phone: "+1 604 555 0155", email: "sofia.alvarez@example.com", medicalNotes: "Post-trauma evaluation, anterior maxillary segment.", toothOfInterest: "11" },
  { fullName: "Jonas Berg", dateOfBirth: "1962-07-19", sex: "male", phone: "+1 604 555 0177", medicalNotes: "Type II diabetic. Monitor perfusion carefully.", toothOfInterest: "36" },
  { fullName: "Priya Nair", dateOfBirth: "2001-09-24", sex: "female", phone: "+1 604 555 0188", email: "priya.nair@example.com", medicalNotes: "Orthodontic patient. Baseline pulp vitality prior to extrusion.", toothOfInterest: "21" },
  { fullName: "Theodore Okafor", dateOfBirth: "1980-01-15", sex: "male", phone: "+1 604 555 0199", medicalNotes: "Deep restoration on #46, monitoring pulp response.", toothOfInterest: "46" },
  { fullName: "Hannah Reinhardt", dateOfBirth: "1993-06-03", sex: "female", phone: "+1 604 555 0201", email: "h.reinhardt@example.com", medicalNotes: "Cracked-tooth syndrome suspected on #35.", toothOfInterest: "35" },
  { fullName: "Wei Zhang", dateOfBirth: "1969-12-11", sex: "male", phone: "+1 604 555 0214", medicalNotes: "Post-crown cementation follow-up on #14.", toothOfInterest: "14" },
  { fullName: "Isabelle Moreau", dateOfBirth: "1985-03-27", sex: "female", phone: "+1 604 555 0225", email: "isabelle.m@example.com", medicalNotes: "Bruxism. Assess pulp health on premolars bilaterally.", toothOfInterest: "24" },
  { fullName: "Rahul Deshpande", dateOfBirth: "1978-08-05", sex: "male", phone: "+1 604 555 0236", medicalNotes: "Trauma to anterior segment 6 weeks ago.", toothOfInterest: "12" },
  { fullName: "Grace O'Malley", dateOfBirth: "2005-05-18", sex: "female", phone: "+1 604 555 0247", email: "grace.omalley@example.com", medicalNotes: "Pediatric follow-up. Recent orthodontic banding.", toothOfInterest: "22" },
  { fullName: "Lars Nyberg", dateOfBirth: "1957-10-02", sex: "male", phone: "+1 604 555 0258", medicalNotes: "Hypertensive. On beta-blocker therapy — expect lower resting pulse.", toothOfInterest: "37" },
];

const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

export function buildSeedPatients(): Patient[] {
  return patientSeed.map((p, i) => ({
    id: `pat_${(i + 1).toString().padStart(3, "0")}`,
    clinicId: CLINIC_ID,
    ...p,
    createdAt: daysAgo(120 - i * 5),
    updatedAt: daysAgo(20 - (i % 10)),
  }));
}

export const seedDevices: Device[] = [
  {
    id: "dev_op_a1",
    clinicId: CLINIC_ID,
    name: "Operatory A · Chair 1",
    deviceId: "OS-ESP32-A1-0148",
    firmware: "1.4.2",
    online: true,
    wifi: { ssid: "Northlake-Clinical", rssi: -52, connected: true },
    mqtt: "connected",
    batteryPct: 87,
    signalStrength: 92,
    lastSeen: new Date(now - 30_000).toISOString(),
    pairedAt: daysAgo(64),
  },
  {
    id: "dev_op_b2",
    clinicId: CLINIC_ID,
    name: "Operatory B · Chair 2",
    deviceId: "OS-ESP32-B2-0217",
    firmware: "1.4.1",
    online: false,
    wifi: { ssid: "Northlake-Clinical", rssi: -78, connected: false },
    mqtt: "disconnected",
    batteryPct: 34,
    signalStrength: 21,
    lastSeen: new Date(now - 3600_000 * 6).toISOString(),
    pairedAt: daysAgo(41),
  },
];

/** Deterministic-ish PPG waveform generator for saved historical tests. */
function synthesizeSamples(seed: number, durationSec: number, hr: number, spo2Base: number): SensorSample[] {
  const out: SensorSample[] = [];
  const hz = 10;
  const total = durationSec * hz;
  let x = seed;
  const rand = () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
  for (let i = 0; i < total; i++) {
    const t = i * (1000 / hz);
    const phase = (i / hz) * (hr / 60) * Math.PI * 2;
    const beat = Math.sin(phase) * 0.6 + Math.sin(phase * 2) * 0.15;
    const noise = (rand() - 0.5) * 0.08;
    const ir = 42000 + beat * 3200 + noise * 400;
    const red = 28000 + beat * 2100 + noise * 300;
    const spo2 = Math.max(90, Math.min(99, spo2Base + Math.sin(i / 40) * 0.6 + (rand() - 0.5) * 0.4));
    const pulse = hr + Math.sin(i / 30) * 3 + (rand() - 0.5) * 1.5;
    const temperature = 36.6 + Math.sin(i / 200) * 0.15 + (rand() - 0.5) * 0.05;
    const signalQuality = Math.max(55, Math.min(98, 88 + Math.sin(i / 25) * 6 + (rand() - 0.5) * 4));
    out.push({
      t,
      red,
      ir,
      spo2: +spo2.toFixed(1),
      pulse: +pulse.toFixed(0),
      temperature: +temperature.toFixed(2),
      batteryPct: Math.max(20, 90 - Math.floor(i / (hz * 60))),
      signalQuality: +signalQuality.toFixed(0),
      confidence: signalQuality > 82 ? "high" : signalQuality > 68 ? "medium" : "low",
    });
  }
  return out;
}

const observationTemplates = [
  "Stable optical response throughout capture. Consistent PPG morphology with clear systolic upstroke and dicrotic notch. Findings support pulp vitality.",
  "Reduced perfusion amplitude compared to contralateral baseline. Delayed dicrotic notch. Recommend clinical correlation and repeat in 2 weeks.",
  "Adequate signal quality with intermittent motion artifact at 00:38 and 01:12. Overall waveform consistent with healthy pulp response.",
  "Diminished IR/Red ratio suggests compromised microcirculation. Consider adjunct thermal test before endodontic planning.",
  "Excellent capture. SpO₂ stable, pulse regular. No indication of pulpal ischemia. Continue observational follow-up.",
];
const verdicts: Array<Test["pulpVerdict"]> = ["vital", "vital", "vital", "non_vital", "inconclusive"];

export function buildSeedTests(patients: Patient[]): Test[] {
  const tests: Test[] = [];
  patients.forEach((pat, pi) => {
    const count = 2 + (pi % 3);
    for (let k = 0; k < count; k++) {
      const durationSec = 45 + ((pi + k) % 4) * 15;
      const hr = 68 + ((pi * 7 + k * 11) % 22);
      const spo2Base = 96 + ((pi + k) % 4) * 0.5;
      const startedAt = new Date(now - (pi * 3 + k) * 86_400_000 - k * 3_600_000).toISOString();
      const endedAt = new Date(new Date(startedAt).getTime() + durationSec * 1000).toISOString();
      const samples = synthesizeSamples(pi * 1000 + k * 37 + 1, durationSec, hr, spo2Base);
      const avgSpO2 = +(samples.reduce((s, x) => s + x.spo2, 0) / samples.length).toFixed(1);
      const avgPulse = Math.round(samples.reduce((s, x) => s + x.pulse, 0) / samples.length);
      const avgTemp = +(samples.reduce((s, x) => s + x.temperature, 0) / samples.length).toFixed(2);
      const minSpO2 = +Math.min(...samples.map((s) => s.spo2)).toFixed(1);
      const maxPulse = Math.round(Math.max(...samples.map((s) => s.pulse)));
      const signalQuality = Math.round(samples.reduce((s, x) => s + x.signalQuality, 0) / samples.length);
      const verdictIdx = (pi + k) % verdicts.length;
      tests.push({
        id: `test_${pat.id}_${k + 1}`,
        clinicId: CLINIC_ID,
        patientId: pat.id,
        deviceId: (pi + k) % 2 === 0 ? "dev_op_a1" : "dev_op_b2",
        doctorId: DOCTOR_ID,
        startedAt,
        endedAt,
        status: "completed",
        toothOfInterest: pat.toothOfInterest,
        samples,
        summary: {
          avgSpO2,
          avgPulse,
          avgTemp,
          minSpO2,
          maxPulse,
          signalQuality,
          confidence: signalQuality > 82 ? "high" : signalQuality > 68 ? "medium" : "low",
          durationSec,
        },
        observations: observationTemplates[(pi + k) % observationTemplates.length],
        pulpVerdict: verdicts[verdictIdx],
      });
    }
  });
  return tests.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

export function buildSeedReports(tests: Test[]): Report[] {
  return tests.slice(0, 18).map((t, i) => ({
    id: `rep_${t.id}`,
    testId: t.id,
    patientId: t.patientId,
    clinicId: CLINIC_ID,
    generatedAt: new Date(new Date(t.endedAt ?? t.startedAt).getTime() + 5 * 60_000).toISOString(),
    aiAnalysis:
      i % 4 === 0
        ? "AI-assisted analysis: perfusion pattern consistent with healthy pulp. Confidence 0.91."
        : undefined,
  }));
}

export function buildSeedActivity(tests: Test[]): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  tests.slice(0, 10).forEach((t, i) => {
    events.push({
      id: `act_start_${i}`,
      at: t.startedAt,
      kind: "test_started",
      message: `Test started on patient ${t.patientId}`,
      refId: t.id,
    });
    events.push({
      id: `act_stop_${i}`,
      at: t.endedAt ?? t.startedAt,
      kind: "test_stopped",
      message: `Test completed — verdict: ${t.pulpVerdict.replace("_", " ")}`,
      refId: t.id,
    });
  });
  events.push({
    id: "act_dev_1",
    at: new Date(now - 3600_000 * 6).toISOString(),
    kind: "device_offline",
    message: "Operatory B · Chair 2 went offline",
    refId: "dev_op_b2",
  });
  events.push({
    id: "act_dev_2",
    at: new Date(now - 300_000).toISOString(),
    kind: "device_online",
    message: "Operatory A · Chair 1 is online",
    refId: "dev_op_a1",
  });
  return events.sort((a, b) => (a.at < b.at ? 1 : -1));
}

export const SEED_META = { CLINIC_ID, DOCTOR_ID };

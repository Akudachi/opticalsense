import { z } from "zod";

export const patientSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the patient's full name").max(120),
  dateOfBirth: z.string().min(1, "Date of birth is required"),
  sex: z.enum(["male", "female", "other"]),
  phone: z.string().trim().min(5, "Enter a valid phone number").max(40),
  email: z.string().trim().email("Invalid email").max(255).optional().or(z.literal("")),
  medicalNotes: z.string().max(1000).optional(),
  toothOfInterest: z.string().trim().max(6).optional(),
});
export type PatientFormValues = z.infer<typeof patientSchema>;

export const clinicSchema = z.object({
  name: z.string().trim().min(2).max(120),
  doctorName: z.string().trim().min(2).max(120),
  address: z.string().trim().min(4).max(240),
  phone: z.string().trim().min(4).max(40),
  email: z.string().trim().email().max(255),
  licenseNo: z.string().trim().max(60).optional(),
  logoDataUrl: z.string().optional(),
});
export type ClinicFormValues = z.infer<typeof clinicSchema>;

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(4, "Password is required"),
  remember: z.boolean().optional(),
});
export type LoginFormValues = z.infer<typeof loginSchema>;

export const pairingSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit pairing code"),
});
export type PairingFormValues = z.infer<typeof pairingSchema>;

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { patientSchema, type PatientFormValues } from "@/utils/validators";
import type { Patient } from "@/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patient?: Patient;
  onSubmit: (values: PatientFormValues) => Promise<void> | void;
};

export function PatientDialog({ open, onOpenChange, patient, onSubmit }: Props) {
  const form = useForm<PatientFormValues>({
    resolver: zodResolver(patientSchema),
    defaultValues: {
      fullName: "",
      dateOfBirth: "",
      sex: "male",
      phone: "",
      email: "",
      medicalNotes: "",
      toothOfInterest: "",
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        fullName: patient?.fullName ?? "",
        dateOfBirth: patient?.dateOfBirth ?? "",
        sex: patient?.sex ?? "male",
        phone: patient?.phone ?? "",
        email: "",
        medicalNotes: patient?.medicalNotes ?? "",
        toothOfInterest: patient?.toothOfInterest ?? "",
      });
    }
  }, [open, patient, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{patient ? "Edit patient" : "Add patient"}</DialogTitle>
          <DialogDescription>
            {patient ? "Update patient details." : "Create a new patient record in the workspace."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={form.handleSubmit(async (v) => {
            await onSubmit(v);
            onOpenChange(false);
          })}
        >
          <Field label="Full name" error={form.formState.errors.fullName?.message}>
            <Input {...form.register("fullName")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date of birth" error={form.formState.errors.dateOfBirth?.message}>
              <Input type="date" {...form.register("dateOfBirth")} />
            </Field>
            <Field label="Sex">
              <Select value={form.watch("sex")} onValueChange={(v) => form.setValue("sex", v as PatientFormValues["sex"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Phone" error={form.formState.errors.phone?.message}>
            <Input {...form.register("phone")} />
          </Field>
          <Field label="Clinical notes" error={form.formState.errors.medicalNotes?.message}>
            <Textarea rows={3} {...form.register("medicalNotes")} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" className="bg-brand-gradient text-white hover:opacity-95" disabled={form.formState.isSubmitting}>
              {patient ? "Save changes" : "Add patient"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

import { AppShell } from "@/components/layout/AppShell";
import { GlassCard } from "@/components/common/GlassCard";
import { PatientDialog } from "@/components/patients/PatientDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDebounce } from "@/hooks/useDebounce";
import { getServices } from "@/services";
import type { Patient } from "@/types";
import { calcAge, formatDate } from "@/utils/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/patients")({
  head: () => ({
    meta: [
      { title: "Patients — OpticalSense" },
      { name: "description", content: "Manage patient records and clinical notes." },
    ],
  }),
  component: PatientsPage,
});

function PatientsPage() {
  const services = getServices();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const dsearch = useDebounce(search, 250);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const { data } = useQuery({
    queryKey: ["patients", dsearch, page],
    queryFn: () => services.patients.list({ search: dsearch, page, pageSize }),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Patient | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<Patient | null>(null);

  const upsertMut = useMutation({
    mutationFn: async (values: Parameters<typeof services.patients.create>[0]) => {
      if (editing) return services.patients.update(editing.id, values);
      return services.patients.create(values);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patients"] });
      toast.success(editing ? "Patient updated" : "Patient added");
      setEditing(undefined);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => services.patients.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patients"] });
      toast.success("Patient removed");
    },
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">{total} patients</div>
          <p className="text-sm text-muted-foreground">Manage clinical records and pulp assessment history.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, phone, tooth…"
              className="w-64 pl-8"
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
            />
          </div>
          <Button onClick={() => { setEditing(undefined); setDialogOpen(true); }} className="bg-brand-gradient text-white hover:opacity-95">
            <Plus className="mr-1 h-4 w-4" /> Add patient
          </Button>
        </div>
      </div>

      <GlassCard padded={false} className="max-h-[calc(100vh-200px)] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>Age · Sex</TableHead>
              <TableHead>Tooth</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                  No patients found.
                </TableCell>
              </TableRow>
            )}
            {items.map((p) => (
              <TableRow key={p.id} className="align-middle">
                <TableCell>
                  <Link to="/patients/$id" params={{ id: p.id }} className="font-medium hover:underline">
                    {p.fullName}
                  </Link>
                  {p.medicalNotes && (
                    <div className="mt-0.5 line-clamp-1 max-w-md text-xs text-muted-foreground">{p.medicalNotes}</div>
                  )}
                </TableCell>
                <TableCell className="text-sm">{calcAge(p.dateOfBirth)} · <span className="capitalize">{p.sex}</span></TableCell>
                <TableCell className="text-sm">{p.toothOfInterest ?? "—"}</TableCell>
                <TableCell className="text-sm">
                  <div>{p.phone}</div>
                  {p.email && <div className="text-xs text-muted-foreground">{p.email}</div>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(p.updatedAt)}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(p); setDialogOpen(true); }}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setConfirmDelete(p)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t border-border/60 px-4 py-3 text-sm text-muted-foreground">
          <div>Page {page} of {pageCount}</div>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </GlassCard>

      <PatientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        patient={editing}
        onSubmit={async (v) => {
          await upsertMut.mutateAsync({ ...v, email: v.email || undefined });
        }}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove patient?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove {confirmDelete?.fullName} from the workspace. Test history is preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => confirmDelete && removeMut.mutate(confirmDelete.id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

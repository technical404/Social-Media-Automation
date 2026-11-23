import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import * as repo from "@/lib/repo";

export const Route = createFileRoute("/_app/campaigns")({
  head: () => ({ meta: [{ title: "Campaigns — SocialAI Studio" }] }),
  component: CampaignsPage,
});

function CampaignsPage() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({ queryKey: ["campaigns"], queryFn: repo.listCampaigns });
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const save = async () => {
    if (!name.trim()) return toast.error("Name is required.");
    await repo.saveCampaign({ name, objective, status: "draft" });
    setName("");
    setObjective("");
    toast.success("Campaign saved");
    qc.invalidateQueries({ queryKey: ["campaigns"] });
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Campaigns" subtitle="Local campaign records. Convert approved events into campaigns from Event Planner." />
      <section className="grid gap-3 rounded-2xl border bg-card p-5 shadow-soft sm:grid-cols-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" />
        <Textarea value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Objective" rows={2} className="sm:col-span-2" />
        <Button onClick={save} className="sm:col-span-2 w-fit">Create campaign</Button>
      </section>
      <ul className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No campaigns yet.</p>}
        {rows.map((c) => (
          <li key={c.id} className="rounded-2xl border bg-card p-4">
            <p className="font-semibold">{c.name}</p>
            <p className="text-sm text-muted-foreground">{c.status} — {c.objective || "No objective"}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

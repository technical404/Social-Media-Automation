import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as repo from "@/lib/repo";

export const Route = createFileRoute("/_app/automation")({
  head: () => ({ meta: [{ title: "Automation — SocialAI Studio" }] }),
  component: AutoPage,
});

function AutoPage() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({ queryKey: ["auto"], queryFn: repo.listAutomations });
  const [name, setName] = useState("");
  const save = async () => {
    if (!name.trim()) return toast.error("Name required");
    await repo.saveAutomation({ name, action: "remind_approvals", enabled: 0, schedule: "manual" });
    toast.success("Rule saved (disabled). Workflows never auto-publish.");
    setName("");
    qc.invalidateQueries({ queryKey: ["auto"] });
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Automation" subtitle="Local rules. Unapproved content is never published automatically." />
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rule name" />
        <Button onClick={save}>Add rule</Button>
      </div>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between rounded-2xl border bg-card p-4">
            <div>
              <p className="font-medium">{r.name}</p>
              <p className="text-xs text-muted-foreground">{r.action} · {r.enabled ? "on" : "off"} · {r.last_status ?? "never run"}</p>
            </div>
            <Button size="sm" variant="outline" onClick={async () => { await repo.runAutomation(r.id); qc.invalidateQueries({ queryKey: ["auto"] }); toast.success("Run recorded"); }}>Run</Button>
          </li>
        ))}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No rules.</p>}
      </ul>
    </div>
  );
}

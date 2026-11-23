import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { runAi } from "@/lib/ai/client";
import * as repo from "@/lib/repo";

export const Route = createFileRoute("/_app/studio")({
  head: () => ({ meta: [{ title: "AI Content Studio — SocialAI Studio" }] }),
  component: StudioPage,
});

const TASKS = [
  { id: "caption", label: "Caption", system: "Write a social media caption. Return only the caption." },
  { id: "hashtags", label: "Hashtags", system: "Suggest 8-12 relevant hashtags. Return them as a single line." },
  { id: "rewrite", label: "Rewrite", system: "Rewrite the user's text more clearly. Return only the rewrite." },
  { id: "reels", label: "Reels script", system: "Write a short vertical-video script with hook, body, CTA." },
  { id: "image_prompt", label: "Image prompt", system: "Write a detailed image-generation prompt." },
];

function StudioPage() {
  const { data: providers = [] } = useQuery({ queryKey: ["providers"], queryFn: repo.listProviders });
  const [task, setTask] = useState("caption");
  const [providerId, setProviderId] = useState<string>("auto");
  const [brief, setBrief] = useState("");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  const t = TASKS.find((x) => x.id === task)!;
  const generate = async () => {
    if (!brief.trim()) return toast.error("Describe what you need first.");
    setBusy(true);
    try {
      const r = await runAi({
        providerId: providerId === "auto" ? null : providerId,
        task,
        system: t.system,
        user: brief,
        json: false,
      });
      setOut(r.text);
      toast.success(`Generated with ${r.providerName} (${r.model})`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const saveDraft = async () => {
    if (!out.trim()) return toast.error("Nothing to save.");
    await repo.savePost({ body: out, platform: "", status: "draft" });
    toast.success("Saved as draft");
  };
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="AI Content Studio" subtitle="Generate text locally through your configured providers. Edit before saving." />
      <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-soft">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Task</Label>
            <Select value={task} onValueChange={setTask}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TASKS.map((x) => <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automatic routing</SelectItem>
                {providers.filter((p) => p.enabled).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Brief</Label>
          <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={5} placeholder="Topic, audience, platform, tone…" />
        </div>
        <Button onClick={generate} disabled={busy}>{busy ? "Generating…" : "Generate"}</Button>
      </section>
      {out && (
        <section className="space-y-3 rounded-2xl border bg-card p-5 shadow-soft">
          <Label>Editable result</Label>
          <Textarea value={out} onChange={(e) => setOut(e.target.value)} rows={10} />
          <Button variant="outline" onClick={saveDraft}>Save as draft</Button>
        </section>
      )}
    </div>
  );
}

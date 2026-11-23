import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import * as repo from "@/lib/repo";

export const Route = createFileRoute("/_app/brand")({
  head: () => ({ meta: [{ title: "Brand voice — SocialAI Studio" }] }),
  component: BrandPage,
});

function BrandPage() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({ queryKey: ["brand"], queryFn: repo.listBrandVoices });
  const [name, setName] = useState("");
  const [tone, setTone] = useState("");
  const [guidelines, setGuidelines] = useState("");
  const save = async () => {
    if (!name.trim()) return toast.error("Brand name required");
    await repo.saveBrandVoice({ name, tone, guidelines });
    toast.success("Brand profile saved");
    setName("");
    setTone("");
    setGuidelines("");
    qc.invalidateQueries({ queryKey: ["brand"] });
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Brand voice" subtitle="Local brand profiles used as AI context." />
      <section className="space-y-3 rounded-2xl border bg-card p-5">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Brand name" />
        <Input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="Tone" />
        <Textarea value={guidelines} onChange={(e) => setGuidelines(e.target.value)} placeholder="Guidelines" rows={4} />
        <Button onClick={save}>Save profile</Button>
      </section>
      <ul className="space-y-2">
        {rows.map((b) => (
          <li key={b.id} className="rounded-xl border bg-card p-4">
            <p className="font-semibold">{b.name}</p>
            <p className="text-sm text-muted-foreground">{b.tone}</p>
          </li>
        ))}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No brand profiles.</p>}
      </ul>
    </div>
  );
}

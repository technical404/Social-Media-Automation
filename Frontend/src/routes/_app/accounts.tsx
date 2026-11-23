import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as repo from "@/lib/repo";

export const Route = createFileRoute("/_app/accounts")({
  head: () => ({ meta: [{ title: "Social accounts — SocialAI Studio" }] }),
  component: AccountsPage,
});

function AccountsPage() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({ queryKey: ["accounts"], queryFn: repo.listAccounts });
  const [platform, setPlatform] = useState("linkedin");
  const [display, setDisplay] = useState("");
  const [handle, setHandle] = useState("");
  const save = async () => {
    if (!display.trim()) return toast.error("Display name required.");
    await repo.saveAccount({
      platform,
      display_name: display,
      handle,
      status: "not_connected",
      note: "OAuth not configured. Passwords are never collected. Connection stays not_connected until official API credentials exist.",
    });
    toast.success("Account placeholder saved (not connected)");
    setDisplay("");
    qc.invalidateQueries({ queryKey: ["accounts"] });
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Social accounts" subtitle="Official OAuth only. No fake connected status." />
      <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        Instagram, Facebook, LinkedIn, X, YouTube, Pinterest and TikTok require developer apps and OAuth. Until you provide those credentials, accounts remain <strong>not connected</strong>.
      </p>
      <section className="grid gap-3 rounded-2xl border bg-card p-5 sm:grid-cols-3">
        <Input value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="platform" />
        <Input value={display} onChange={(e) => setDisplay(e.target.value)} placeholder="Display name" />
        <Input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="Handle" />
        <Button onClick={save} className="sm:col-span-3 w-fit">Add account record</Button>
      </section>
      <ul className="space-y-3">
        {rows.map((a) => (
          <li key={a.id} className="rounded-2xl border bg-card p-4">
            <p className="font-semibold">{a.display_name} <span className="text-sm font-normal text-muted-foreground">@{a.handle || "—"}</span></p>
            <p className="text-sm">{a.platform} · {a.status}</p>
            {a.note && <p className="mt-1 text-xs text-muted-foreground">{a.note}</p>}
          </li>
        ))}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No accounts recorded.</p>}
      </ul>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import * as repo from "@/lib/repo";

export const Route = createFileRoute("/_app/media")({
  head: () => ({ meta: [{ title: "Media library — SocialAI Studio" }] }),
  component: MediaPage,
});

function MediaPage() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({ queryKey: ["media"], queryFn: repo.listMedia });
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of files) {
      const ok = /^(image|video)\//.test(f.type) || /\.(png|jpe?g|gif|webp|mp4|webm)$/i.test(f.name);
      if (!ok) {
        toast.error(`${f.name}: unsupported type`);
        continue;
      }
      if (f.name.includes("..") || f.name.includes("/") || f.name.includes("\\")) {
        toast.error("Unsafe filename rejected");
        continue;
      }
      await repo.addMediaMeta(f.name, f.type || "application/octet-stream", f.size);
    }
    toast.success("Metadata saved. Files stay on this PC; binary store uses Python media folder when launched via main.py.");
    qc.invalidateQueries({ queryKey: ["media"] });
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Media library" subtitle="Local metadata. Unsafe paths are rejected." />
      <input type="file" multiple accept="image/*,video/*" onChange={(e) => onFiles(e.target.files)} />
      <ul className="space-y-2">
        {rows.map((m) => (
          <li key={m.id} className="rounded-xl border bg-card px-4 py-3 text-sm">
            <span className="font-medium">{m.filename}</span> · {m.mime} · {m.bytes} bytes
          </li>
        ))}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No media recorded.</p>}
      </ul>
    </div>
  );
}

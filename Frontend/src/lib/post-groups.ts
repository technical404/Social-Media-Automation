import type { PostRow } from "./repo";

export type PostGroup = { topic: string; rows: PostRow[] };

/** Group posts under their topic; posts without a topic go to "General posts". */
export function groupPostsByTopic(posts: PostRow[]): PostGroup[] {
  const groups = new Map<string, PostRow[]>();
  for (const post of posts) {
    const topic = (post.topic ?? "").trim() || "General posts";
    groups.set(topic, [...(groups.get(topic) ?? []), post]);
  }
  return [...groups.entries()]
    .map(([topic, rows]) => ({
      topic,
      rows: [...rows].sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? "")),
    }))
    .sort((a, b) => (a.rows[0]?.scheduled_at ?? "").localeCompare(b.rows[0]?.scheduled_at ?? ""));
}

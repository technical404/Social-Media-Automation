import { CONTENT_TYPES } from "./planner";

export const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
  youtube: "YouTube",
  tiktok: "TikTok",
  pinterest: "Pinterest",
};
export const PLATFORMS = Object.keys(PLATFORM_LABEL);

/** Facebook and Instagram share one Meta product surface in the planner. */
export const META_PLATFORMS = ["facebook", "instagram"] as const;

export const PLATFORM_GROUPS: { id: string; label: string; platforms: string[] }[] = [
  { id: "meta", label: "Meta", platforms: [...META_PLATFORMS] },
  { id: "linkedin", label: "LinkedIn", platforms: ["linkedin"] },
  { id: "x", label: "X", platforms: ["x"] },
  { id: "youtube", label: "YouTube", platforms: ["youtube"] },
  { id: "tiktok", label: "TikTok", platforms: ["tiktok"] },
  { id: "pinterest", label: "Pinterest", platforms: ["pinterest"] },
];

/** Formats offered after a platform is chosen. Other platforms fall back to all formats. */
export const PLATFORM_CONTENT_TYPES: Record<string, string[]> = {
  instagram: ["Reel", "Carousel", "Static post", "Story", "Video", "Image", "GIF", "Live"],
  facebook: ["Static post", "Reel", "Carousel", "Story", "Video", "Image", "GIF", "Live", "Poll"],
  linkedin: ["Post", "Carousel", "Video", "Image", "Poll", "Live"],
  x: ["Post", "Poll", "Video", "Image", "GIF", "Live"],
  youtube: ["Short video", "Video", "Live"],
  tiktok: ["Short video", "Video", "Live"],
  pinterest: ["Image", "Video", "Carousel", "Static post"],
};

/** Union of the formats supported by every selected platform, in canonical order. */
export function contentTypesForPlatforms(platforms: string[]): string[] {
  const selected = platforms.map((p) => PLATFORM_CONTENT_TYPES[p]).filter(Boolean);
  if (!selected.length) return [...CONTENT_TYPES];
  const allowed = new Set(selected.flat());
  return CONTENT_TYPES.filter((type) => allowed.has(type));
}

/** "Meta" when both Meta networks are selected, otherwise the individual names. */
export function platformSummary(platforms: string[]): string {
  const metaSelected = META_PLATFORMS.filter((p) => platforms.includes(p));
  const others = platforms.filter((p) => !META_PLATFORMS.includes(p as (typeof META_PLATFORMS)[number]));
  const labels = [
    ...(metaSelected.length === META_PLATFORMS.length ? ["Meta"] : metaSelected.map((p) => PLATFORM_LABEL[p])),
    ...others.map((p) => PLATFORM_LABEL[p] ?? p),
  ];
  return labels.join(", ");
}

export const STATUS_LABEL: Record<string, string> = {
  pending_review: "Needs review",
  approved: "Approved",
  rejected: "Rejected",
  draft: "Draft",
  pending_approval: "Pending approval",
  not_scheduled: "Not scheduled",
  scheduled: "Scheduled",
  published: "Published",
  failed: "Failed",
};

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

import { createFileRoute, redirect } from "@tanstack/react-router";

// No login and no landing page: the app opens straight into the dashboard.
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SocialAI Studio — local AI event & social planner" },
      { name: "description", content: "Offline-first studio for AI event calendars, three-month planning and approved scheduling." },
      { property: "og:title", content: "SocialAI Studio — local AI event & social planner" },
      { property: "og:description", content: "Offline-first studio for AI event calendars, three-month planning and approved scheduling." },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/dashboard", replace: true });
  },
});

-- lovable-cron-fallback-reviewed: scheduled posts must publish at user-chosen times while no browser is open; 5-minute cadence (288 runs/day) bounds delay
ALTER FUNCTION public.posts_guard() SECURITY INVOKER;
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('publish-due-posts', '*/5 * * * *', $$SELECT public.publish_due_posts();$$);
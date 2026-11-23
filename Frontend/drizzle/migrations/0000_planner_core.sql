
-- Updated-at helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============ AI providers ============
CREATE TABLE public.ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  protocol text NOT NULL CHECK (protocol IN ('openai','anthropic','gemini','openai_compatible','nvidia','ollama')),
  base_url text NOT NULL,
  model_id text NOT NULL,
  context_window integer,
  max_output integer,
  thinking_effort text NOT NULL DEFAULT 'none' CHECK (thinking_effort IN ('none','low','medium','high')),
  image_input boolean NOT NULL DEFAULT false,
  provider_type text NOT NULL DEFAULT 'hosted' CHECK (provider_type IN ('hosted','local')),
  enabled boolean NOT NULL DEFAULT true,
  is_default_text boolean NOT NULL DEFAULT false,
  temperature numeric(3,2),
  timeout_ms integer NOT NULL DEFAULT 60000,
  max_retries integer NOT NULL DEFAULT 1,
  has_api_key boolean NOT NULL DEFAULT false,
  api_key_hint text,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_message text,
  last_test_ms integer,
  last_success_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_providers TO authenticated;
GRANT ALL ON public.ai_providers TO service_role;
ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own providers select" ON public.ai_providers FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own providers insert" ON public.ai_providers FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own providers update" ON public.ai_providers FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own providers delete" ON public.ai_providers FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER ai_providers_updated BEFORE UPDATE ON public.ai_providers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Secrets: never readable by browser clients; server code only (service_role)
CREATE TABLE public.ai_provider_secrets (
  provider_id uuid PRIMARY KEY REFERENCES public.ai_providers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  api_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ai_provider_secrets TO service_role;
ALTER TABLE public.ai_provider_secrets ENABLE ROW LEVEL SECURITY;

-- ============ Event calendars ============
CREATE TABLE public.event_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  industry text,
  prompt text,
  scope text NOT NULL DEFAULT 'year' CHECK (scope IN ('year','month','dates','range')),
  start_date date,
  end_date date,
  default_time time NOT NULL DEFAULT '10:00',
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_calendars TO authenticated;
GRANT ALL ON public.event_calendars TO service_role;
ALTER TABLE public.event_calendars ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own calendars select" ON public.event_calendars FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own calendars insert" ON public.event_calendars FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own calendars update" ON public.event_calendars FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own calendars delete" ON public.event_calendars FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER event_calendars_updated BEFORE UPDATE ON public.event_calendars FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id uuid NOT NULL REFERENCES public.event_calendars(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  event_date date NOT NULL,
  event_time time NOT NULL DEFAULT '10:00',
  title text NOT NULL,
  description text,
  category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX calendar_events_cal_date ON public.calendar_events(calendar_id, event_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_events TO authenticated;
GRANT ALL ON public.calendar_events TO service_role;
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own events select" ON public.calendar_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own events insert" ON public.calendar_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.event_calendars c WHERE c.id = calendar_id AND c.user_id = auth.uid()));
CREATE POLICY "own events update" ON public.calendar_events FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own events delete" ON public.calendar_events FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER calendar_events_updated BEFORE UPDATE ON public.calendar_events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ Posts with approval gate ============
CREATE TABLE public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  calendar_event_id uuid REFERENCES public.calendar_events(id) ON DELETE SET NULL,
  brand text,
  platform text NOT NULL,
  caption text NOT NULL DEFAULT '',
  hashtags text[] NOT NULL DEFAULT '{}',
  cta text,
  image_prompt text,
  alt_text text,
  hooks jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('draft','generating','pending_review','approved','scheduled','publishing','published','failed','rejected','cancelled')),
  version integer NOT NULL DEFAULT 1,
  approved_version integer,
  approved_at timestamptz,
  scheduled_at timestamptz,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  published_at timestamptz,
  publish_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX posts_due ON public.posts(status, scheduled_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts TO authenticated;
GRANT ALL ON public.posts TO service_role;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own posts select" ON public.posts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own posts insert" ON public.posts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own posts update" ON public.posts FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own posts delete" ON public.posts FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.post_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  version integer NOT NULL,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.post_versions TO authenticated;
GRANT ALL ON public.post_versions TO service_role;
ALTER TABLE public.post_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own versions select" ON public.post_versions FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  action text NOT NULL,
  from_status text,
  to_status text,
  version integer,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own audit select" ON public.audit_log FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Approval gate, enforced in the database so no client or API call can bypass it
CREATE OR REPLACE FUNCTION public.posts_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE material_changed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Every new post starts unapproved
    IF NEW.status NOT IN ('draft','generating','pending_review') THEN NEW.status := 'pending_review'; END IF;
    NEW.approved_version := NULL; NEW.approved_at := NULL; NEW.version := 1;
    NEW.published_at := NULL; NEW.publish_result := NULL;
    RETURN NEW;
  END IF;

  material_changed := (NEW.caption IS DISTINCT FROM OLD.caption)
    OR (NEW.hashtags IS DISTINCT FROM OLD.hashtags)
    OR (NEW.cta IS DISTINCT FROM OLD.cta)
    OR (NEW.platform IS DISTINCT FROM OLD.platform)
    OR (NEW.image_prompt IS DISTINCT FROM OLD.image_prompt)
    OR (NEW.alt_text IS DISTINCT FROM OLD.alt_text);

  -- Clients may never write publish results or version counters directly
  IF current_user IN ('authenticated','anon') THEN
    NEW.version := OLD.version;
    NEW.published_at := OLD.published_at;
    NEW.publish_result := OLD.publish_result;
    IF NEW.status IN ('publishing','published','failed') AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Only the scheduler can mark a post as %', NEW.status;
    END IF;
  END IF;

  IF material_changed THEN
    NEW.version := OLD.version + 1;
    IF OLD.status IN ('approved','scheduled') OR NEW.status IN ('approved','scheduled') THEN
      NEW.status := 'pending_review';
    END IF;
    NEW.approved_version := NULL; NEW.approved_at := NULL;
  END IF;

  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' AND NOT material_changed THEN
    IF OLD.status NOT IN ('pending_review','scheduled','rejected','draft','failed') THEN
      RAISE EXCEPTION 'Cannot approve a post in status %', OLD.status;
    END IF;
    IF OLD.status <> 'scheduled' THEN
      NEW.approved_version := NEW.version; NEW.approved_at := now();
    END IF;
  END IF;

  IF NEW.status = 'scheduled' THEN
    IF NEW.approved_version IS NULL OR NEW.approved_version <> NEW.version THEN
      RAISE EXCEPTION 'Only approved content can be scheduled';
    END IF;
    IF NEW.scheduled_at IS NULL THEN RAISE EXCEPTION 'A publication date and time is required'; END IF;
  END IF;

  IF NEW.status IN ('rejected','cancelled','pending_review','draft') THEN
    NEW.approved_version := CASE WHEN NEW.status = 'cancelled' THEN NEW.approved_version ELSE NULL END;
    IF NEW.status <> 'cancelled' THEN NEW.approved_at := NULL; END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END; $$;
CREATE TRIGGER posts_guard_trg BEFORE INSERT OR UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.posts_guard();

CREATE OR REPLACE FUNCTION public.posts_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.version IS DISTINCT FROM OLD.version THEN
    INSERT INTO public.post_versions(post_id, user_id, version, content)
    VALUES (NEW.id, NEW.user_id, NEW.version, jsonb_build_object(
      'caption', NEW.caption, 'hashtags', to_jsonb(NEW.hashtags), 'cta', NEW.cta,
      'platform', NEW.platform, 'image_prompt', NEW.image_prompt, 'alt_text', NEW.alt_text));
  END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log(user_id, post_id, action, to_status, version, detail)
    VALUES (NEW.user_id, NEW.id, 'created', NEW.status, NEW.version, NULL);
  ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.version IS DISTINCT FROM OLD.version THEN
    INSERT INTO public.audit_log(user_id, post_id, action, from_status, to_status, version, detail)
    VALUES (NEW.user_id, NEW.id,
      CASE WHEN NEW.version IS DISTINCT FROM OLD.version THEN 'edited' ELSE 'status_changed' END,
      OLD.status, NEW.status, NEW.version,
      CASE WHEN NEW.version IS DISTINCT FROM OLD.version AND OLD.status IN ('approved','scheduled') THEN 'Approval invalidated by edit' ELSE NULL END);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER posts_history_trg AFTER INSERT OR UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.posts_history();

-- Scheduler: publishes due posts in mock mode (no real social account is called)
CREATE OR REPLACE FUNCTION public.publish_due_posts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT id FROM public.posts
    WHERE status = 'scheduled' AND scheduled_at <= now()
      AND approved_version IS NOT NULL AND approved_version = version
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.posts SET status = 'published', published_at = now(),
      publish_result = jsonb_build_object('mode','mock','message','Mock publish recorded. No real social account was contacted.','at', now())
    WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.publish_due_posts() FROM PUBLIC, anon, authenticated;

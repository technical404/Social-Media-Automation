CREATE OR REPLACE FUNCTION public.posts_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE material_changed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
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

  -- Clients can never write approval stamps, versions or publish results directly
  IF current_user IN ('authenticated','anon') THEN
    NEW.version := OLD.version;
    NEW.approved_version := OLD.approved_version;
    NEW.approved_at := OLD.approved_at;
    NEW.published_at := OLD.published_at;
    NEW.publish_result := OLD.publish_result;
    IF NEW.status IN ('publishing','published','failed') AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Only the scheduler can mark a post as %', NEW.status;
    END IF;
    IF OLD.status IN ('publishing','published') THEN
      RAISE EXCEPTION 'Published posts can no longer be changed';
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

  IF NEW.status IN ('rejected','pending_review','draft') THEN
    NEW.approved_version := NULL; NEW.approved_at := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END; $$;
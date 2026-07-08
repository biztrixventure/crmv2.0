-- ============================================================================
-- 185_qa_transcripts.sql   🗣️ QA on-demand call transcription cache
-- Stores the transcript TEXT for a recording the first time a reviewer clicks
-- "Transcribe", keyed by the recording's identity (box_id:recording_id). Repeat
-- opens read from here — no re-transcribe, no re-spend. Audio is NEVER stored;
-- only the text lives here.
-- Backend-only (service_role); RLS enabled with no policy = deny-all for
-- anon/authenticated (mig 179 posture).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.qa_transcripts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_key text UNIQUE NOT NULL,          -- '<box_id>:<recording_id>'
  box_id        text,
  recording_id  text,
  lead_id       text,
  language      text,
  duration      numeric,
  text          text NOT NULL DEFAULT '',
  segments      jsonb,                          -- [{start,end,text}] for timestamped view
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qa_transcripts ENABLE ROW LEVEL SECURITY;
-- no policy → deny-all for anon/authenticated; the service-role backend bypasses RLS.
REVOKE ALL ON public.qa_transcripts FROM anon, authenticated;

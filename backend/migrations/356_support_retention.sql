-- 356: customer retention -- the Support Agent's desk.
--
-- A support agent works for named CLIENTS (Falcon, James Mtm, ...). Their job
-- is to call that client's customers -- the ones who cancelled, and the ones
-- who have not yet -- and keep them on the policy. Every call is logged; a
-- customer they win back is marked Saved and sent to compliance, and
-- compliance's approval is what puts the sale back to Active.
--
--   support_agent_clients  which clients an agent works (set by superadmin /
--                          compliance). No row = the agent sees nothing.
--   retention_cases        one piece of retention work on one sale. At most
--                          ONE live case per sale (partial unique index), so
--                          two agents cannot work the same customer.
--   retention_calls        every call on a case: outcome, the agent's own
--                          story, an optional follow-up time.
--
-- status: open -> saved -> pending_approval -> approved
--                                           -> returned (compliance sent it
--                                              back; agent works it again)
--         open / saved / returned -> lost
--
-- THE SALE IS ONLY TOUCHED ON APPROVAL, by the route (routes/support.js):
-- status back to closed_won, cancellation_date cleared, and the three
-- reinstate columns stamped. What the sale looked like before is kept on the
-- case (sale_status_at_open, cancellation_*_at_open), so the original
-- cancellation is never lost and the reinstatement can be reversed by hand.
--
-- sale_id is ON DELETE SET NULL, not CASCADE (the mig 352 lesson): deleting a
-- sale must not silently erase an agent's logged work. customer_name /
-- reference_no are snapshotted on the case so its report row still reads.
--
-- Everything is service-role only (RLS on, no policies) -- the API scopes
-- every read to the agent's clients.

CREATE TABLE IF NOT EXISTS public.support_agent_clients (
  user_id     uuid NOT NULL,
  client_name text NOT NULL,
  assigned_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_name)
);

CREATE TABLE IF NOT EXISTS public.retention_cases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id       uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  agent_id      uuid NOT NULL,
  client_name   text,
  company_id    uuid,
  customer_name text,
  reference_no  text,
  status        text NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','saved','pending_approval','approved','returned','lost')),
  sale_status_at_open            text,
  cancellation_date_at_open      date,
  cancellation_reason_at_open    text,
  save_reason   text,
  lost_reason   text,
  saved_at      timestamptz,
  submitted_at  timestamptz,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  review_note   text,
  sale_reinstated boolean NOT NULL DEFAULT false,
  call_count    integer NOT NULL DEFAULT 0,
  last_call_at  timestamptz,
  next_follow_up_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_retention_live_case
  ON public.retention_cases (sale_id)
  WHERE status IN ('open','saved','pending_approval','returned');
CREATE INDEX IF NOT EXISTS idx_retention_cases_agent  ON public.retention_cases (agent_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_retention_cases_status ON public.retention_cases (status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_retention_cases_sale   ON public.retention_cases (sale_id);

CREATE TABLE IF NOT EXISTS public.retention_calls (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      uuid NOT NULL REFERENCES public.retention_cases(id) ON DELETE CASCADE,
  sale_id      uuid,
  agent_id     uuid NOT NULL,
  outcome      text NOT NULL,
  notes        text,
  follow_up_at timestamptz,
  called_at    timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_retention_calls_case  ON public.retention_calls (case_id, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_retention_calls_agent ON public.retention_calls (agent_id, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_retention_calls_sale  ON public.retention_calls (sale_id);

ALTER TABLE public.support_agent_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_cases       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_calls       ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_agent_clients, public.retention_cases, public.retention_calls FROM anon, authenticated;

-- The reinstatement, on the sale itself (the "Reinstate Date / Reinstated By /
-- Reinstate Reason" boxes on the policy screen).
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS reinstated_at    timestamptz;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS reinstated_by    uuid;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS reinstate_reason text;

-- The role, for every closer company (the support desk sits on the closer
-- side). Tiny on purpose: the role LEVEL is what opens /support; it holds no
-- sale, transfer or callback permission, so no other screen opens for it.
INSERT INTO public.custom_roles (name, description, level, company_id)
SELECT 'Support Agent',
       'Customer retention — calls a client''s customers to keep them on their policy',
       'support_agent', c.id
  FROM public.companies c
 WHERE c.company_type = 'closer'
   AND NOT EXISTS (SELECT 1 FROM public.custom_roles r
                    WHERE r.company_id = c.id AND r.level::text = 'support_agent');

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.custom_roles r
  JOIN public.permissions p ON p.name = 'view_notifications'
 WHERE r.level::text = 'support_agent'
   AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp
                    WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- The timeline: an approval that carries a fresh reinstated_at is written as
-- 'reinstated' (already an allowed policy_events type) instead of 'approved',
-- with the reason as its note. Everything else is mig 354's function unchanged.
CREATE OR REPLACE FUNCTION public.fn_log_policy_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  ev   text;
  who  uuid;
  pd_new boolean;
  pd_old boolean;
BEGIN
  pd_new := fn_is_post_date(NEW.closer_disposition);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta)
    VALUES (
      NEW.id,
      -- A post-date is a reminder, not a sale: 'sold' is written when it is
      -- charged (the UPDATE branch below), never when it is keyed.
      CASE WHEN pd_new THEN 'post_dated'
           WHEN COALESCE(NEW.is_resell, false)
           THEN (CASE WHEN COALESCE(NEW.resell_intent,'') ILIKE '%renew%' THEN 'renewed' ELSE 'replaced' END)
           ELSE 'sold' END,
      -- A post-date's sale_date is the FUTURE charge day; the event is now.
      CASE WHEN pd_new THEN COALESCE(NEW.created_at, now())
           ELSE COALESCE(NEW.sale_date::timestamptz, NEW.created_at, now()) END,
      NEW.created_by,
      jsonb_build_object('to_status', NEW.status,
                         'original_sale_id', NEW.original_sale_id,
                         'resell_intent', NEW.resell_intent,
                         'charge_at', CASE WHEN pd_new THEN NEW.charge_at END)
    );
    RETURN NEW;
  END IF;

  pd_old := fn_is_post_date(OLD.closer_disposition);

  -- post-date -> sale: THIS is the sale. The charge flipped the disposition.
  IF pd_old AND NOT pd_new THEN
    INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta)
    VALUES (NEW.id, 'sold', now(), COALESCE(NEW.last_modified_by, NEW.created_by),
            jsonb_build_object('from', 'post_date', 'charge_at', OLD.charge_at, 'to_status', NEW.status));
  -- an existing sale switched to post-date
  ELSIF pd_new AND NOT pd_old THEN
    INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta)
    VALUES (NEW.id, 'post_dated', now(), COALESCE(NEW.last_modified_by, NEW.created_by),
            jsonb_build_object('charge_at', NEW.charge_at));
  END IF;

  -- status transition
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    ev := CASE NEW.status::text   -- ::text: the enum lacks expired/resold/refunded (mig 354)
            WHEN 'pending_review'       THEN 'submitted'
            WHEN 'closed_won'           THEN 'approved'
            WHEN 'sold'                 THEN 'approved'
            WHEN 'needs_revision'       THEN 'returned'
            WHEN 'cancelled'            THEN 'cancelled'
            WHEN 'compliance_cancelled' THEN 'cancelled'
            WHEN 'chargeback'           THEN 'chargeback'
            WHEN 'expired'              THEN 'expired'
            WHEN 'resold'               THEN 'resold'
            WHEN 'closed_lost'          THEN 'lost'
            WHEN 'refunded'             THEN 'refunded'
            WHEN 'dispute'              THEN 'dispute'
            ELSE NULL
          END;
    -- A retention save approved by compliance (mig 356): the sale comes back.
    IF ev = 'approved' AND NEW.reinstated_at IS NOT NULL
       AND NEW.reinstated_at IS DISTINCT FROM OLD.reinstated_at THEN
      ev := 'reinstated';
    END IF;
    IF ev IS NOT NULL THEN
      who := COALESCE(NEW.compliance_reviewed_by, NEW.last_modified_by, NEW.submitted_by, NEW.created_by);
      INSERT INTO policy_events (sale_id, event_type, at, actor_id, note, meta)
      VALUES (NEW.id, ev, now(), who,
              CASE WHEN ev = 'reinstated' THEN NEW.reinstate_reason ELSE NEW.compliance_note END,
              jsonb_build_object('from_status', OLD.status, 'to_status', NEW.status));
    END IF;
  END IF;

  -- supersession (one active policy per VIN)
  IF NEW.superseded_by IS DISTINCT FROM OLD.superseded_by AND NEW.superseded_by IS NOT NULL THEN
    INSERT INTO policy_events (sale_id, event_type, at, actor_id, note, meta)
    VALUES (NEW.id, 'superseded', COALESCE(NEW.superseded_at, now()),
            NEW.last_modified_by, NEW.superseded_reason,
            jsonb_build_object('superseded_by', NEW.superseded_by));
  END IF;

  -- cancellation date set independently of status
  IF NEW.cancellation_date IS DISTINCT FROM OLD.cancellation_date
     AND NEW.cancellation_date IS NOT NULL
     AND NEW.status NOT IN ('cancelled','compliance_cancelled') THEN
    INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta)
    VALUES (NEW.id, 'cancelled', NEW.cancellation_date::timestamptz,
            COALESCE(NEW.last_modified_by, NEW.created_by),
            jsonb_build_object('cancellation_reason_key', NEW.cancellation_reason_key));
  END IF;

  -- chargeback recorded
  IF NEW.chargeback_date IS DISTINCT FROM OLD.chargeback_date AND NEW.chargeback_date IS NOT NULL THEN
    INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta)
    VALUES (NEW.id, 'chargeback', NEW.chargeback_date::timestamptz,
            COALESCE(NEW.last_modified_by, NEW.created_by),
            jsonb_build_object('chargeback_amount', NEW.chargeback_amount));
  END IF;

  -- post-date charge REMINDER fired (the scheduler's stamp, not the charge)
  IF NEW.charge_notified_at IS DISTINCT FROM OLD.charge_notified_at AND NEW.charge_notified_at IS NOT NULL THEN
    INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta)
    VALUES (NEW.id, 'charged', NEW.charge_notified_at,
            COALESCE(NEW.last_modified_by, NEW.created_by),
            jsonb_build_object('charge_at', NEW.charge_at));
  END IF;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $function$;

-- 355: the support_agent role level (customer retention).
--
-- Its own migration because Postgres refuses to USE a new enum value in the
-- transaction that added it -- 356 seeds a role with this level, so the value
-- has to be committed first. Same split as qa_manager (208) / trainee (311).

ALTER TYPE role_level ADD VALUE IF NOT EXISTS 'support_agent';

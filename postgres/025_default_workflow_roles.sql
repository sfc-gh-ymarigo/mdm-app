-- 025: Default workflow roles. Users created by 005 (and before mdm_roles existed) have none, so
-- nobody can take a workflow step on a fresh install. Derive them from the app role; users that
-- already have workflow roles are left alone.
UPDATE mdm.app_user
SET mdm_roles = CASE role
                  WHEN 'ADMIN'   THEN ARRAY['MDM_ADMIN']
                  WHEN 'STEWARD' THEN ARRAY['DATA_STEWARD']
                  ELSE ARRAY['DATA_CONSUMER']
                END
WHERE COALESCE(cardinality(mdm_roles), 0) = 0;

-- 009: Snowflake identity mapping (app user ↔ Snowflake user/role).
-- Tables are in the snowflake_cdc publication: never ADD COLUMN ... DEFAULT.

ALTER TABLE mdm.app_user ADD COLUMN IF NOT EXISTS sf_user VARCHAR(255);
ALTER TABLE mdm.app_user ADD COLUMN IF NOT EXISTS sf_role VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS app_user_sf_user_uq ON mdm.app_user (upper(sf_user));

-- Bootstrap admin is the Snowflake account admin.
UPDATE mdm.app_user SET sf_user = 'ADMIN'
 WHERE email = 'benoit.declarens@example.com' AND sf_user IS NULL;

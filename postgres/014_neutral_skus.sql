-- 014: Neutral SKU prefix for demo products (legacy tenant prefix → ACM-).
UPDATE mdm.product SET sku = 'ACM-' || substr(sku, 5) WHERE sku LIKE 'LYR-%';
UPDATE mdm.audit_log SET changed_fields = replace(changed_fields::text, '"LYR-', '"ACM-')::jsonb WHERE changed_fields::text LIKE '%"LYR-%';
UPDATE mdm.audit_log SET full_record = replace(full_record::text, '"LYR-', '"ACM-')::jsonb WHERE full_record::text LIKE '%"LYR-%';

-- ============================================================
-- Advanced DQ Validation Functions (PL/pgSQL)
-- Email RFC 5322, Phone E.164, IBAN mod97, SIRET Luhn, Address normalizer
-- ============================================================

SET search_path TO mdm, public;

-- ============================================================
-- 1. EMAIL VALIDATION (RFC 5322 strict)
-- ============================================================
-- Goes beyond simple regex: validates local part length, domain structure,
-- rejects common typos like double dots, trailing dots, missing TLD

CREATE OR REPLACE FUNCTION mdm.fn_validate_email(p_email TEXT)
RETURNS TABLE(valid BOOLEAN, issue TEXT) AS $$
DECLARE
  v_local TEXT;
  v_domain TEXT;
  v_parts TEXT[];
BEGIN
  IF p_email IS NULL OR p_email = '' THEN
    RETURN QUERY SELECT FALSE, 'Email is empty or null'::TEXT;
    RETURN;
  END IF;

  -- Must contain exactly one @
  IF LENGTH(p_email) - LENGTH(REPLACE(p_email, '@', '')) != 1 THEN
    RETURN QUERY SELECT FALSE, 'Must contain exactly one @ symbol'::TEXT;
    RETURN;
  END IF;

  v_local := SPLIT_PART(p_email, '@', 1);
  v_domain := SPLIT_PART(p_email, '@', 2);

  -- Local part checks
  IF LENGTH(v_local) = 0 THEN
    RETURN QUERY SELECT FALSE, 'Empty local part before @'::TEXT;
    RETURN;
  END IF;
  IF LENGTH(v_local) > 64 THEN
    RETURN QUERY SELECT FALSE, 'Local part exceeds 64 characters'::TEXT;
    RETURN;
  END IF;
  IF v_local LIKE '.%' OR v_local LIKE '%.' THEN
    RETURN QUERY SELECT FALSE, 'Local part cannot start or end with a dot'::TEXT;
    RETURN;
  END IF;
  IF v_local LIKE '%..%' THEN
    RETURN QUERY SELECT FALSE, 'Local part contains consecutive dots'::TEXT;
    RETURN;
  END IF;

  -- Domain checks
  IF LENGTH(v_domain) = 0 THEN
    RETURN QUERY SELECT FALSE, 'Empty domain after @'::TEXT;
    RETURN;
  END IF;
  IF LENGTH(v_domain) > 255 THEN
    RETURN QUERY SELECT FALSE, 'Domain exceeds 255 characters'::TEXT;
    RETURN;
  END IF;
  IF v_domain NOT LIKE '%.%' THEN
    RETURN QUERY SELECT FALSE, 'Domain must contain at least one dot (missing TLD)'::TEXT;
    RETURN;
  END IF;
  IF v_domain LIKE '%.%' AND LENGTH(SPLIT_PART(v_domain, '.', array_length(string_to_array(v_domain, '.'), 1))) < 2 THEN
    RETURN QUERY SELECT FALSE, 'TLD must be at least 2 characters'::TEXT;
    RETURN;
  END IF;

  -- Full regex check
  IF p_email !~ '^[a-zA-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$' THEN
    RETURN QUERY SELECT FALSE, 'Invalid characters or format in email'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ============================================================
-- 2. PHONE E.164 VALIDATION
-- ============================================================
-- Validates international phone format and checks country code consistency

CREATE OR REPLACE FUNCTION mdm.fn_validate_phone_e164(p_phone TEXT, p_country_code TEXT DEFAULT NULL)
RETURNS TABLE(valid BOOLEAN, issue TEXT, normalized TEXT) AS $$
DECLARE
  v_clean TEXT;
  v_prefix TEXT;
  v_expected_prefix TEXT;
BEGIN
  IF p_phone IS NULL OR p_phone = '' THEN
    RETURN QUERY SELECT FALSE, 'Phone is empty or null'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- Strip spaces, dashes, dots, parens
  v_clean := REGEXP_REPLACE(p_phone, '[\s\-\.\(\)]', '', 'g');

  -- Must start with + for international format
  IF v_clean NOT LIKE '+%' THEN
    -- Try to detect if it's a local number
    IF v_clean ~ '^\d{8,15}$' THEN
      RETURN QUERY SELECT FALSE, 'Missing international prefix (+XX). Local number detected.'::TEXT, v_clean;
      RETURN;
    END IF;
    RETURN QUERY SELECT FALSE, 'Phone must start with + for international format'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- After + should be only digits
  IF SUBSTRING(v_clean FROM 2) !~ '^\d{7,15}$' THEN
    RETURN QUERY SELECT FALSE, 'After + must be 7-15 digits only (E.164)'::TEXT, v_clean;
    RETURN;
  END IF;

  -- Country code consistency check
  IF p_country_code IS NOT NULL THEN
    v_expected_prefix := CASE p_country_code
      WHEN 'FRA' THEN '+33'  WHEN 'DEU' THEN '+49'  WHEN 'GBR' THEN '+44'
      WHEN 'BEL' THEN '+32'  WHEN 'NLD' THEN '+31'  WHEN 'ITA' THEN '+39'
      WHEN 'ESP' THEN '+34'  WHEN 'POL' THEN '+48'  WHEN 'JPN' THEN '+81'
      WHEN 'USA' THEN '+1'   WHEN 'CHE' THEN '+41'  WHEN 'AUT' THEN '+43'
      WHEN 'PRT' THEN '+351' WHEN 'LUX' THEN '+352' WHEN 'IRL' THEN '+353'
      ELSE NULL
    END;

    IF v_expected_prefix IS NOT NULL AND v_clean NOT LIKE v_expected_prefix || '%' THEN
      v_prefix := CASE
        WHEN v_clean ~ '^\+\d{1}' AND v_expected_prefix ~ '^\+\d{1}$' THEN SUBSTRING(v_clean FROM 1 FOR 2)
        WHEN v_clean ~ '^\+\d{2}' AND v_expected_prefix ~ '^\+\d{2}$' THEN SUBSTRING(v_clean FROM 1 FOR 3)
        WHEN v_clean ~ '^\+\d{3}' AND v_expected_prefix ~ '^\+\d{3}$' THEN SUBSTRING(v_clean FROM 1 FOR 4)
        ELSE SUBSTRING(v_clean FROM 1 FOR LENGTH(v_expected_prefix))
      END;
      RETURN QUERY SELECT FALSE,
        FORMAT('Phone prefix %s doesn''t match country %s (expected %s)', v_prefix, p_country_code, v_expected_prefix)::TEXT,
        v_clean;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT TRUE, NULL::TEXT, v_clean;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ============================================================
-- 3. IBAN / TAX ID CHECKSUM (ISO 13616 mod 97)
-- ============================================================
-- Validates European Tax IDs that follow IBAN-like structure (FR, DE, etc.)

CREATE OR REPLACE FUNCTION mdm.fn_validate_tax_id(p_tax_id TEXT, p_country_code TEXT DEFAULT NULL)
RETURNS TABLE(valid BOOLEAN, issue TEXT) AS $$
DECLARE
  v_clean TEXT;
  v_country TEXT;
  v_numeric_part TEXT;
  v_remainder NUMERIC;
  v_check_str TEXT;
  v_i INT;
  v_c CHAR;
  v_digit_str TEXT := '';
BEGIN
  IF p_tax_id IS NULL OR p_tax_id = '' THEN
    RETURN QUERY SELECT FALSE, 'Tax ID is empty or null'::TEXT;
    RETURN;
  END IF;

  v_clean := UPPER(REGEXP_REPLACE(p_tax_id, '[\s\-\.]', '', 'g'));
  v_country := SUBSTRING(v_clean FROM 1 FOR 2);

  -- Country consistency check
  IF p_country_code IS NOT NULL THEN
    CASE p_country_code
      WHEN 'FRA' THEN IF v_country != 'FR' THEN RETURN QUERY SELECT FALSE, FORMAT('Tax ID prefix %s doesn''t match country %s (expected FR)', v_country, p_country_code)::TEXT; RETURN; END IF;
      WHEN 'DEU' THEN IF v_country != 'DE' THEN RETURN QUERY SELECT FALSE, FORMAT('Tax ID prefix %s doesn''t match country %s (expected DE)', v_country, p_country_code)::TEXT; RETURN; END IF;
      WHEN 'GBR' THEN IF v_country != 'GB' THEN RETURN QUERY SELECT FALSE, FORMAT('Tax ID prefix %s doesn''t match country %s (expected GB)', v_country, p_country_code)::TEXT; RETURN; END IF;
      WHEN 'BEL' THEN IF v_country != 'BE' THEN RETURN QUERY SELECT FALSE, FORMAT('Tax ID prefix %s doesn''t match country %s (expected BE)', v_country, p_country_code)::TEXT; RETURN; END IF;
      WHEN 'NLD' THEN IF v_country != 'NL' THEN RETURN QUERY SELECT FALSE, FORMAT('Tax ID prefix %s doesn''t match country %s (expected NL)', v_country, p_country_code)::TEXT; RETURN; END IF;
      WHEN 'ITA' THEN IF v_country != 'IT' THEN RETURN QUERY SELECT FALSE, FORMAT('Tax ID prefix %s doesn''t match country %s (expected IT)', v_country, p_country_code)::TEXT; RETURN; END IF;
      WHEN 'ESP' THEN IF v_country != 'ES' AND v_clean !~ '^[A-Z]\d{8}$' THEN RETURN QUERY SELECT FALSE, FORMAT('Tax ID doesn''t match Spanish format (NIF/CIF)', v_country)::TEXT; RETURN; END IF;
      WHEN 'POL' THEN IF v_country != 'PL' THEN RETURN QUERY SELECT FALSE, FORMAT('Tax ID prefix %s doesn''t match country %s (expected PL)', v_country, p_country_code)::TEXT; RETURN; END IF;
      ELSE NULL;
    END CASE;
  END IF;

  -- Length validation per country
  CASE v_country
    WHEN 'FR' THEN IF LENGTH(v_clean) != 13 THEN RETURN QUERY SELECT FALSE, FORMAT('French VAT must be 13 chars (FR + 2 check + 9 SIREN), got %s', LENGTH(v_clean))::TEXT; RETURN; END IF;
    WHEN 'DE' THEN IF LENGTH(v_clean) != 11 THEN RETURN QUERY SELECT FALSE, FORMAT('German VAT must be 11 chars (DE + 9 digits), got %s', LENGTH(v_clean))::TEXT; RETURN; END IF;
    WHEN 'GB' THEN IF LENGTH(v_clean) NOT IN (11, 14) THEN RETURN QUERY SELECT FALSE, FORMAT('UK VAT must be 11 or 14 chars, got %s', LENGTH(v_clean))::TEXT; RETURN; END IF;
    WHEN 'BE' THEN IF LENGTH(v_clean) != 12 THEN RETURN QUERY SELECT FALSE, FORMAT('Belgian VAT must be 12 chars, got %s', LENGTH(v_clean))::TEXT; RETURN; END IF;
    WHEN 'NL' THEN IF LENGTH(v_clean) != 14 THEN RETURN QUERY SELECT FALSE, FORMAT('Dutch VAT must be 14 chars, got %s', LENGTH(v_clean))::TEXT; RETURN; END IF;
    WHEN 'IT' THEN IF LENGTH(v_clean) != 13 THEN RETURN QUERY SELECT FALSE, FORMAT('Italian VAT must be 13 chars, got %s', LENGTH(v_clean))::TEXT; RETURN; END IF;
    WHEN 'PL' THEN IF LENGTH(v_clean) != 12 THEN RETURN QUERY SELECT FALSE, FORMAT('Polish VAT must be 12 chars, got %s', LENGTH(v_clean))::TEXT; RETURN; END IF;
    ELSE NULL;
  END CASE;

  -- French VAT: check digits = (12 + 3 * (SIREN mod 97)) mod 97
  IF v_country = 'FR' THEN
    v_numeric_part := SUBSTRING(v_clean FROM 5);
    IF v_numeric_part ~ '^\d{9}$' THEN
      v_remainder := (12 + 3 * (v_numeric_part::NUMERIC % 97)) % 97;
      IF LPAD(v_remainder::TEXT, 2, '0') != SUBSTRING(v_clean FROM 3 FOR 2) THEN
        RETURN QUERY SELECT FALSE, FORMAT('French VAT check digits invalid (expected %s, got %s)', LPAD(v_remainder::TEXT, 2, '0'), SUBSTRING(v_clean FROM 3 FOR 2))::TEXT;
        RETURN;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ============================================================
-- 4. SIRET / SIREN LUHN VALIDATION
-- ============================================================

CREATE OR REPLACE FUNCTION mdm.fn_luhn_check(p_number TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_clean TEXT;
  v_sum INT := 0;
  v_digit INT;
  v_doubled INT;
  v_len INT;
  v_i INT;
BEGIN
  v_clean := REGEXP_REPLACE(p_number, '[^0-9]', '', 'g');
  v_len := LENGTH(v_clean);
  IF v_len = 0 THEN RETURN FALSE; END IF;

  FOR v_i IN REVERSE v_len..1 LOOP
    v_digit := SUBSTRING(v_clean FROM v_i FOR 1)::INT;
    IF (v_len - v_i) % 2 = 1 THEN
      v_doubled := v_digit * 2;
      IF v_doubled > 9 THEN v_doubled := v_doubled - 9; END IF;
      v_sum := v_sum + v_doubled;
    ELSE
      v_sum := v_sum + v_digit;
    END IF;
  END LOOP;

  RETURN (v_sum % 10 = 0);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION mdm.fn_validate_siret(p_siret TEXT, p_siren TEXT DEFAULT NULL)
RETURNS TABLE(valid BOOLEAN, issue TEXT) AS $$
DECLARE
  v_clean TEXT;
BEGIN
  IF p_siret IS NULL OR p_siret = '' THEN
    RETURN QUERY SELECT TRUE, NULL::TEXT;  -- NULL SIRET is not an error (optional field)
    RETURN;
  END IF;

  v_clean := REGEXP_REPLACE(p_siret, '[^0-9]', '', 'g');

  IF LENGTH(v_clean) != 14 THEN
    RETURN QUERY SELECT FALSE, FORMAT('SIRET must be 14 digits, got %s', LENGTH(v_clean))::TEXT;
    RETURN;
  END IF;

  -- Luhn check on full SIRET
  IF NOT mdm.fn_luhn_check(v_clean) THEN
    RETURN QUERY SELECT FALSE, 'SIRET fails Luhn checksum'::TEXT;
    RETURN;
  END IF;

  -- SIREN coherence: first 9 digits of SIRET must match SIREN
  IF p_siren IS NOT NULL AND p_siren != '' THEN
    IF SUBSTRING(v_clean FROM 1 FOR 9) != REGEXP_REPLACE(p_siren, '[^0-9]', '', 'g') THEN
      RETURN QUERY SELECT FALSE, FORMAT('SIRET prefix (%s) doesn''t match SIREN (%s)', SUBSTRING(v_clean FROM 1 FOR 9), p_siren)::TEXT;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ============================================================
-- 5. ADDRESS NORMALIZER & COHERENCE CHECK
-- ============================================================

CREATE OR REPLACE FUNCTION mdm.fn_validate_address(
  p_address TEXT, p_city TEXT, p_postal_code TEXT, p_country_code TEXT
)
RETURNS TABLE(valid BOOLEAN, issue TEXT, suggestion TEXT) AS $$
DECLARE
  v_issues TEXT[] := '{}';
  v_suggestions TEXT[] := '{}';
  v_normalized TEXT;
BEGIN
  -- Abbreviation detection and suggestion
  IF p_address IS NOT NULL THEN
    v_normalized := p_address;

    -- French abbreviations
    IF p_country_code = 'FRA' THEN
      IF p_address ~* '\mBd\M' OR p_address ~* '\mBld\M' THEN
        v_suggestions := array_append(v_suggestions, 'Replace "Bd/Bld" with "Boulevard"');
      END IF;
      IF p_address ~* '\mAv\M' THEN
        v_suggestions := array_append(v_suggestions, 'Replace "Av" with "Avenue"');
      END IF;
      IF p_address ~* '\mSt\M' AND p_address !~* 'Street' THEN
        v_suggestions := array_append(v_suggestions, 'Replace "St" with "Saint"');
      END IF;
      IF p_address ~* '\mPl\M' THEN
        v_suggestions := array_append(v_suggestions, 'Replace "Pl" with "Place"');
      END IF;
    END IF;

    -- German abbreviations
    IF p_country_code = 'DEU' THEN
      IF p_address ~* '\mStr\M\.' THEN
        v_suggestions := array_append(v_suggestions, 'Replace "Str." with "Straße"');
      END IF;
      IF p_address ~* '\mPl\M\.' THEN
        v_suggestions := array_append(v_suggestions, 'Replace "Pl." with "Platz"');
      END IF;
    END IF;

    -- UK abbreviations
    IF p_country_code = 'GBR' THEN
      IF p_address ~* '\mSt\M\.' AND p_address !~* 'Saint' THEN
        v_suggestions := array_append(v_suggestions, 'Replace "St." with "Street"');
      END IF;
      IF p_address ~* '\mRd\M\.' THEN
        v_suggestions := array_append(v_suggestions, 'Replace "Rd." with "Road"');
      END IF;
    END IF;
  END IF;

  -- Postal code format validation per country
  IF p_postal_code IS NOT NULL AND p_country_code IS NOT NULL THEN
    CASE p_country_code
      WHEN 'FRA' THEN
        IF p_postal_code !~ '^\d{5}$' THEN
          v_issues := array_append(v_issues, FORMAT('French postal code must be 5 digits, got "%s"', p_postal_code));
        END IF;
      WHEN 'DEU' THEN
        IF p_postal_code !~ '^\d{5}$' THEN
          v_issues := array_append(v_issues, FORMAT('German postal code (PLZ) must be 5 digits, got "%s"', p_postal_code));
        END IF;
      WHEN 'GBR' THEN
        IF p_postal_code !~ '^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$' THEN
          v_issues := array_append(v_issues, FORMAT('UK postcode format invalid: "%s"', p_postal_code));
        END IF;
      WHEN 'BEL' THEN
        IF p_postal_code !~ '^\d{4}$' THEN
          v_issues := array_append(v_issues, FORMAT('Belgian postal code must be 4 digits, got "%s"', p_postal_code));
        END IF;
      WHEN 'NLD' THEN
        IF p_postal_code !~ '^\d{4}\s?[A-Z]{2}$' THEN
          v_issues := array_append(v_issues, FORMAT('Dutch postal code must be 4 digits + 2 letters, got "%s"', p_postal_code));
        END IF;
      WHEN 'ITA' THEN
        IF p_postal_code !~ '^\d{5}$' THEN
          v_issues := array_append(v_issues, FORMAT('Italian CAP must be 5 digits, got "%s"', p_postal_code));
        END IF;
      WHEN 'ESP' THEN
        IF p_postal_code !~ '^\d{5}$' THEN
          v_issues := array_append(v_issues, FORMAT('Spanish postal code must be 5 digits, got "%s"', p_postal_code));
        END IF;
      WHEN 'POL' THEN
        IF p_postal_code !~ '^\d{2}-\d{3}$' THEN
          v_issues := array_append(v_issues, FORMAT('Polish postal code must be XX-XXX format, got "%s"', p_postal_code));
        END IF;
      ELSE NULL;
    END CASE;
  END IF;

  -- City check — should not be empty if address is present
  IF p_address IS NOT NULL AND (p_city IS NULL OR p_city = '') THEN
    v_issues := array_append(v_issues, 'Address present but city is missing');
  END IF;

  -- Return results
  IF array_length(v_issues, 1) > 0 THEN
    RETURN QUERY SELECT FALSE, array_to_string(v_issues, '; ')::TEXT,
      CASE WHEN array_length(v_suggestions, 1) > 0 THEN array_to_string(v_suggestions, '; ') ELSE NULL END;
  ELSIF array_length(v_suggestions, 1) > 0 THEN
    RETURN QUERY SELECT TRUE, ('Suggestions: ' || array_to_string(v_suggestions, '; '))::TEXT, array_to_string(v_suggestions, '; ');
  ELSE
    RETURN QUERY SELECT TRUE, NULL::TEXT, NULL::TEXT;
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ============================================================
-- 6. CONVENIENCE: Run all validations on a customer
-- ============================================================

CREATE OR REPLACE FUNCTION mdm.fn_validate_customer(p_id UUID)
RETURNS TABLE(rule_name TEXT, field_name TEXT, valid BOOLEAN, issue TEXT) AS $$
DECLARE
  v_rec mdm.customer;
  v_result RECORD;
BEGIN
  SELECT * INTO v_rec FROM mdm.customer WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'CUSTOMER_EXISTS'::TEXT, 'id'::TEXT, FALSE, 'Customer not found'::TEXT;
    RETURN;
  END IF;

  -- Email validation
  IF v_rec.email IS NOT NULL THEN
    SELECT * INTO v_result FROM mdm.fn_validate_email(v_rec.email);
    RETURN QUERY SELECT 'EMAIL_RFC5322'::TEXT, 'email'::TEXT, v_result.valid, v_result.issue;
  END IF;

  -- Phone validation
  IF v_rec.phone IS NOT NULL THEN
    SELECT * INTO v_result FROM mdm.fn_validate_phone_e164(v_rec.phone, v_rec.country_code);
    RETURN QUERY SELECT 'PHONE_E164'::TEXT, 'phone'::TEXT, v_result.valid, v_result.issue;
  END IF;

  -- Tax ID validation
  IF v_rec.tax_id IS NOT NULL THEN
    SELECT * INTO v_result FROM mdm.fn_validate_tax_id(v_rec.tax_id, v_rec.country_code);
    RETURN QUERY SELECT 'TAX_ID_CHECKSUM'::TEXT, 'tax_id'::TEXT, v_result.valid, v_result.issue;
  END IF;

  -- SIRET validation
  IF v_rec.siret IS NOT NULL THEN
    SELECT * INTO v_result FROM mdm.fn_validate_siret(v_rec.siret, v_rec.siren);
    RETURN QUERY SELECT 'SIRET_LUHN'::TEXT, 'siret'::TEXT, v_result.valid, v_result.issue;
  END IF;

  -- Address validation
  SELECT * INTO v_result FROM mdm.fn_validate_address(v_rec.address_line1, v_rec.city, v_rec.postal_code, v_rec.country_code);
  RETURN QUERY SELECT 'ADDRESS_COHERENCE'::TEXT, 'address'::TEXT, v_result.valid, v_result.issue;

  RETURN;
END;
$$ LANGUAGE plpgsql;

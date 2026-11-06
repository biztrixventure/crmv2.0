// ============================================================================
// useExternalModules -- does this company run HR / QA in another app?
// (mig 348 flags external_hr / external_qa, both default OFF.)
//
//   const ext = useExternalModules();   // { hr: url|null, qa: url|null }
//
// A non-null url means: hide the CRM's own HR (or QA) navigation and show ONE
// link out to that url instead. Flags are read STRICTLY, so before migration
// 348 (flag missing) or with the flag off this returns nulls and every screen
// is exactly what it was. The CRM pages themselves are never removed.
//
// The urls come from GET /external-modules (HR_APP_URL / QA_APP_URL on the
// server), asked once per page load and only when a flag is actually on.
// ============================================================================
import { useEffect, useState } from 'react';
import { useFeatureFlags } from '../contexts/FeatureFlagsContext';
import client from '../api/client';

const DEFAULTS = { hr_url: 'https://hr.vertexpakistan.com', qa_url: 'https://qa.vertexpakistan.com' };

let _urls = null;
let _pending = null;
function loadUrls() {
  if (_urls) return Promise.resolve(_urls);
  if (!_pending) {
    _pending = client.get('external-modules')
      .then((r) => { _urls = { ...DEFAULTS, ...(r.data || {}) }; return _urls; })
      .catch(() => { _pending = null; return DEFAULTS; });
  }
  return _pending;
}

export default function useExternalModules() {
  const { isEnabledStrict } = useFeatureFlags();
  const hrOn = isEnabledStrict('external_hr');
  const qaOn = isEnabledStrict('external_qa');
  const [urls, setUrls] = useState(_urls || DEFAULTS);

  useEffect(() => {
    if (!hrOn && !qaOn) return undefined;
    let dead = false;
    loadUrls().then((u) => { if (!dead) setUrls(u); });
    return () => { dead = true; };
  }, [hrOn, qaOn]);

  return { hr: hrOn ? urls.hr_url : null, qa: qaOn ? urls.qa_url : null };
}

// ============================================================================
// routes/externalModules.js -- where HR and QA live when a company runs them
// outside the CRM (mig 348 flags external_hr / external_qa).
//
//   GET /api/external-modules   { hr_url, qa_url }   (any signed-in user)
//
// The flags decide WHETHER a company's HR / QA navigation becomes one link
// out (frontend hooks/useExternalModules.js reads them strictly, so a missing
// flag is off). This only says WHERE the link goes:
//   HR_APP_URL  default https://hr.vertexpakistan.com
//   QA_APP_URL  default https://qa.vertexpakistan.com
// ============================================================================
const express = require('express');

const DEFAULT_HR = 'https://hr.vertexpakistan.com';
const DEFAULT_QA = 'https://qa.vertexpakistan.com';

function clean(v, fallback) {
  const s = String(v || '').trim();
  if (!s) return fallback;
  try {
    const u = new URL(s);
    return ['https:', 'http:'].includes(u.protocol) ? s.replace(/\/+$/, '') : fallback;
  } catch {
    return fallback;
  }
}

function externalUrls() {
  return {
    hr_url: clean(process.env.HR_APP_URL, DEFAULT_HR),
    qa_url: clean(process.env.QA_APP_URL, DEFAULT_QA),
  };
}

const router = express.Router();
router.get('/', (req, res) => res.json(externalUrls()));

module.exports = router;
module.exports.externalUrls = externalUrls;

<?php
/**
 * vicidial_dispo_push.php — runs ON the VICIdial server via cron.
 *
 * Reads new CLOSER dispositions from vicidial_closer_log and POSTs each to the
 * BizTrix CRM closer-dispo endpoint. This replaces the Dispo Call URL (which
 * does not fire for transferred/inbound calls) — the script has the full row
 * (vendor_lead_code, phone, disposition, agent), so the CRM matches exactly.
 *
 * INSTALL (on the dialer, as root or the VICIdial user):
 *   1. Put this file at /usr/share/astguiclient/vicidial_dispo_push.php
 *   2. Make the marker dir writable:  mkdir -p /var/log/astguiclient && touch /var/log/astguiclient/crm_dispo_last.txt && chmod 666 /var/log/astguiclient/crm_dispo_last.txt
 *   3. Cron (every minute):
 *        * * * * * php /usr/share/astguiclient/vicidial_dispo_push.php >/dev/null 2>&1
 *
 * It only sends CLOSER dispositions whose lead carries a vendor_lead_code
 * (i.e. leads pushed by the fronter webform with the prefix), so it won't spam
 * the CRM with unrelated calls.
 */

// ── CONFIG ────────────────────────────────────────────────────────────────────
$CRM_URL   = 'https://crm.vertexpakistan.com/api/vicidial/closer-dispo';
$CRM_KEY   = '1122qqwweerrttyy1122';                 // = VICIDIAL_INGEST_TOKEN in the CRM env
$MARKER    = '/var/log/astguiclient/crm_dispo_last.txt'; // remembers the last row sent

// DB creds — read from VICIdial's own config so you don't hardcode them.
// (Falls back to the defaults below if the file can't be read.)
$DB = ['host' => '127.0.0.1', 'db' => 'asterisk', 'user' => 'cron', 'pass' => '1234'];
$conf = @file_get_contents('/etc/astguiclient.conf');
if ($conf !== false) {
  foreach ([['VARDB_server','host'], ['VARDB_database','db'], ['VARDB_user','user'], ['VARDB_pass','pass']] as $m) {
    if (preg_match('/^'.$m[0].'\s*=>?\s*(.+)$/mi', $conf, $x)) $DB[$m[1]] = trim($x[1]);
  }
}

// Only forward real, finished dispositions (skip system/in-progress statuses).
$SKIP = ['', 'INCALL', 'QUEUE', 'PAUSED', 'LOGIN', 'CLOSER', 'XFER'];

// ── run ───────────────────────────────────────────────────────────────────────
$mysqli = @mysqli_connect($DB['host'], $DB['user'], $DB['pass'], $DB['db']);
if (!$mysqli) { fwrite(STDERR, "DB connect failed: ".mysqli_connect_error()."\n"); exit(1); }

$lastId = (int) (is_file($MARKER) ? trim(@file_get_contents($MARKER)) : 0);

// First run ever: start from the current tail so we don't replay weeks of history.
if ($lastId === 0) {
  $r = mysqli_query($mysqli, "SELECT COALESCE(MAX(closecallid),0) AS m FROM vicidial_closer_log");
  $row = $r ? mysqli_fetch_assoc($r) : ['m' => 0];
  $lastId = (int) $row['m'];
  @file_put_contents($MARKER, $lastId);
  exit(0);
}

// New closer dispositions since the last marker, joined to the lead for vendor_lead_code.
$sql = "SELECT ccl.closecallid, ccl.status, ccl.user, ccl.phone_number, ccl.lead_id,
               vl.vendor_lead_code
        FROM vicidial_closer_log ccl
        LEFT JOIN vicidial_list vl ON vl.lead_id = ccl.lead_id
        WHERE ccl.closecallid > $lastId
        ORDER BY ccl.closecallid ASC
        LIMIT 300";
$res = mysqli_query($mysqli, $sql);
if (!$res) { fwrite(STDERR, "query failed: ".mysqli_error($mysqli)."\n"); exit(1); }

$maxId = $lastId;
while ($row = mysqli_fetch_assoc($res)) {
  $maxId  = max($maxId, (int) $row['closecallid']);
  $status = trim((string) $row['status']);
  if (in_array(strtoupper($status), $SKIP, true)) continue;

  $params = http_build_query([
    'key'        => $CRM_KEY,
    'code'       => (string) $row['vendor_lead_code'],   // ETC{leadid} → exact match
    'alt_code'   => (string) $row['lead_id'],
    'phone'      => (string) $row['phone_number'],
    'dispo'      => $status,
    'agent'      => (string) $row['user'],
  ]);

  $ch = curl_init($CRM_URL.'?'.$params);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 8,
    CURLOPT_SSL_VERIFYPEER => true,
  ]);
  curl_exec($ch);
  curl_close($ch);
}

@file_put_contents($MARKER, $maxId);
mysqli_close($mysqli);

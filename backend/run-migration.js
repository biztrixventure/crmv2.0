#!/usr/bin/env node
/**
 * Migration runner — a copy-paste helper, not a real executor. Supabase's
 * REST/SDK surface has no arbitrary-DDL endpoint (see runViaSDK below), so
 * this script cannot actually run a migration — it never could. What it CAN
 * do honestly:
 *   1. Warn if a NEW migration (numbered > 231, when schema_migrations
 *      tracking started — see mig 231) forgot to end with a self-registering
 *      INSERT INTO schema_migrations, so tracking never silently drifts.
 *   2. `--verify`: after you've pasted the file into the Supabase SQL editor
 *      and run it, re-run this script with --verify to confirm the migration
 *      actually registered itself — a plain SELECT works fine over the SDK
 *      even though DDL doesn't, so this is a real check, not a guess.
 *
 * Usage: node run-migration.js <path-to-sql-file> [--verify]
 */
require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');
const https = require('https');

const sqlFile = process.argv[2];
const verifyMode = process.argv.includes('--verify');
if (!sqlFile) {
  console.error('Usage: node run-migration.js <path-to-sql-file> [--verify]');
  process.exit(1);
}

const sql = fs.readFileSync(path.resolve(sqlFile), 'utf8');
const filename = path.basename(sqlFile);
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Split SQL into individual statements and execute each one
// This avoids issues with transaction handling and multi-statement DDL
const statements = sql
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'));

async function execSQL(statement) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: statement + ';' });
    const url = new URL(SUPABASE_URL);

    const options = {
      hostname: url.hostname,
      path: '/rest/v1/rpc/exec_sql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Migrations from mig 231 onward are expected to end with a self-registering
// INSERT INTO schema_migrations — warn here so a forgotten one is caught
// before apply, not discovered later as a silent gap in the ledger.
function warnIfUnregistered() {
  const numMatch = filename.match(/^(\d+)/);
  const num = numMatch ? parseInt(numMatch[1], 10) : null;
  if (num !== null && num > 231 && !/schema_migrations/i.test(sql)) {
    console.warn(`⚠️  ${filename} never mentions schema_migrations.`);
    console.warn('    Add a trailing self-registering INSERT (see mig 231\'s pattern)');
    console.warn('    or --verify will never find it after this file is applied.\n');
  }
}

// Confirms an apply actually happened, by reading the ledger a migration's
// own trailing INSERT should have written. A plain SELECT works fine over
// the SDK even though arbitrary DDL doesn't — this is a real check.
async function verify() {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await supabase
    .from('schema_migrations')
    .select('filename, applied_at, note')
    .eq('filename', filename)
    .maybeSingle();

  if (error) {
    console.error(`Could not query schema_migrations: ${error.message}`);
    console.error('(schema_migrations itself may not exist yet — apply mig 231 first)');
    process.exit(1);
  }
  if (data) {
    console.log(`✅ ${filename} is recorded — applied_at ${data.applied_at}${data.note ? ` (${data.note})` : ''}`);
  } else {
    console.log(`❌ ${filename} is NOT in schema_migrations yet.`);
    console.log('   Did you paste it into the Supabase SQL editor and run it?');
    console.log('   If it ran but has no trailing self-registering INSERT, add one');
    console.log('   (see mig 231) and re-apply just that INSERT statement.');
  }
}

// Use Supabase pg connection via the SDK instead
async function runViaSDK() {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  console.log(`Running migration: ${sqlFile}`);
  warnIfUnregistered();

  // Execute statements one by one using rpc if possible, or batch
  // For DDL, we use supabase's query builder workaround
  // Actually, we need to use the pg package with service role

  // Try using Supabase's REST endpoint for schema changes
  const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });

  console.log('API accessible:', response.status === 200);
  console.log('\n⚠️  Note: DDL migrations require the Supabase SQL Editor or psql.');
  console.log('Please run the following file in Supabase SQL Editor:');
  console.log(`  → ${path.resolve(sqlFile)}\n`);
  console.log('Migration SQL saved. Copy it from the file above into:');
  console.log('  Supabase Dashboard → SQL Editor → New Query → Paste → Run');
  console.log(`\nAfter running it there, verify it registered:`);
  console.log(`  node run-migration.js ${sqlFile} --verify`);
}

(verifyMode ? verify() : runViaSDK()).catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});

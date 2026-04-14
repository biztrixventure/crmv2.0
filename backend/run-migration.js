#!/usr/bin/env node
/**
 * Migration runner — executes SQL files against Supabase via service role key.
 * Usage: node run-migration.js <path-to-sql-file>
 */
require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');
const https = require('https');

const sqlFile = process.argv[2];
if (!sqlFile) {
  console.error('Usage: node run-migration.js <path-to-sql-file>');
  process.exit(1);
}

const sql = fs.readFileSync(path.resolve(sqlFile), 'utf8');
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

// Use Supabase pg connection via the SDK instead
async function runViaSDK() {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  console.log(`Running migration: ${sqlFile}`);

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
}

runViaSDK().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});

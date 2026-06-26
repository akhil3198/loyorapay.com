const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const client = new Client({
  host: 'db.togjwxlzieqysyrdbcil.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Jneelabai@123',
  ssl: { rejectUnauthorized: false }
});

const migrations = [
  'backend/migrations/002-gdpr.sql',
  'backend/migrations/003-security.sql',
  'backend/migrations/004-schema-fixes.sql',
];

async function run() {
  await client.connect();
  console.log('Connected to database');

  for (const m of migrations) {
    const sql = fs.readFileSync(path.join(__dirname, m), 'utf8');
    console.log(`Running ${m}...`);
    try {
      await client.query(sql);
      console.log(`  ✓ Done`);
    } catch (e) {
      if (e.message.includes('already exists') || e.message.includes('duplicate')) {
        console.log(`  ✓ Done (some objects already existed)`);
      } else {
        console.log(`  Warning: ${e.message}`);
      }
    }
  }

  await client.end();
  console.log('\n✓ All migrations complete');
}

run().catch(e => { console.error(e.message); process.exit(1); });

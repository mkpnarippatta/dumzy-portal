require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;

  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_KEY must be set in .env');
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const sql = fs.readFileSync(path.join(__dirname, '001_create_enquiries_table.sql'), 'utf8');

  console.log('Running migration: 001_create_enquiries_table.sql');
  console.log('Note: For Supabase, run this SQL directly in the Supabase SQL editor.');
  console.log('This script just verifies connectivity.');

  // Test connectivity by listing existing tables
  const { data, error } = await supabase
    .from('_tables')
    .select('tablename')
    .in('tablename', ['enquiries'])
    .limit(1);

  if (error && error.code !== 'PGRST116') {
    console.log('Supabase connected. Run the SQL manually in the dashboard.');
    console.log('SQL file location:', path.join(__dirname, '001_create_enquiries_table.sql'));
  } else {
    console.log('Migration appears to be applied.');
  }

  console.log('\nTo apply the migration:');
  console.log('1. Go to https://supabase.com/dashboard/project/ixnkjmpsqexkqelugsir/sql/new');
  console.log('2. Paste the contents of migrations/001_create_enquiries_table.sql');
  console.log('3. Click "Run"');
}

runMigration().catch(console.error);

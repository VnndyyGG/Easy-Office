const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'");
  console.log('Listo. Tablas en la base:', rows[0].count);
  await pool.end();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
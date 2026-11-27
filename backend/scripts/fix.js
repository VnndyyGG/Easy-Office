const { Pool } = require('pg');

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined,
  });
  await pool.query(`
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES templates(id);
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS form_data TEXT;
  `);
  const { rows } = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='documents' ORDER BY ordinal_position"
  );
  console.log('Columnas de documents:', rows.map(r => r.column_name).join(', '));
  await pool.end();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
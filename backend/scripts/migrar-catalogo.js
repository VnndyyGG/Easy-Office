const fs = require('node:fs');
const file = 'db/templates/catalogo.json';
const cat = JSON.parse(fs.readFileSync(file, 'utf8'));
const PERSONAS = ['representante_rut', 'propietario_rut', 'arrendador_rut', 'arrendatario_rut', 'apoderado_rut', 'rut_entrante'];
const PREFILL = { representante_nombre: 'cliente.nombre', representante_rut: 'cliente.run', cliente_email: 'cliente.email' };
const CON_PREFILL = ['contrato-servicios-oficina', 'contrato-servicios-bodega', 'contrato-arriendo-vehiculo'];
const fix = (fields, slug) => fields.forEach(f => {
  if (PERSONAS.includes(f.key)) { f.type = 'run'; f.label = f.label.replace(/\bRUT\b/, 'RUN'); }
  if (CON_PREFILL.includes(slug) && PREFILL[f.key]) f.prefill = PREFILL[f.key];
  f.label = f.label.replace('(nombre, RUT,', '(nombre, RUN,').replace('(nombre y RUT)', '(nombre y RUN)').replace('(nombre, RUT y', '(nombre, RUN y');
});
for (const t of cat.templates) {
  fix(t.fields, t.slug);
  (t.clauses || []).forEach(c => fix(c.fields || [], t.slug));
  t.service.requiresSignature = true;
  t.service.signatureLevel = t.slug === 'acuerdo-accionistas-spa' ? 'avanzada' : 'simple';
}
fs.writeFileSync(file, JSON.stringify(cat, null, 2) + '\n');
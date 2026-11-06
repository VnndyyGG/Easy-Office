// Protección de datos (Ley 19.628 mod. Ley 21.719): aviso versionado, exportación (acceso/portabilidad), solicitudes con plazo,
// bloqueo, supresión por anonimización y registro de incidentes.
const v = require('./validation');
const { randomBytes } = require('node:crypto');
const { VERSION, politica } = require('./politica');

const TIPOS = ['acceso', 'rectificacion', 'supresion', 'oposicion', 'portabilidad', 'bloqueo'];
const DIAS = n => n * 86400000;
const PLAZO_DIAS = 30;   // corridos, prorrogables una sola vez por otros 30
const ABIERTO = ['recibida', 'en_proceso'];

function createPrivacidad({ run, insert, one, all, atomic, audit, notify, roles, now }) {
  const iso = (name, value) => {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) v.fail(400, 'VALIDATION_ERROR', `${name}: fecha ISO 8601 requerida.`);
    return new Date(value).toISOString();
  };

  async function anonymize(userId) {
    const user = await one('SELECT * FROM users WHERE id=? FOR UPDATE', userId);
    if (!user || user.role !== 'cliente') v.fail(409, 'NOT_ERASABLE', 'Solo se puede anonimizar la cuenta de un cliente.');
    if (await one("SELECT id FROM cases WHERE client_id=? AND status NOT IN ('completado','entregado','cancelado') LIMIT 1", userId))
      v.fail(409, 'OPEN_CASES', 'El cliente tiene trámites en curso. Ciérralos o cancélalos antes de suprimir sus datos.');
    if (await one("SELECT id FROM orders WHERE client_id=? AND status IN ('iniciada','procesando') LIMIT 1", userId))
      v.fail(409, 'OPEN_ORDERS', 'Hay un pago en curso.');
    await run(`UPDATE users SET name='Titular eliminado', email=?, run='', password_hash=?, active=0, blocked_until=NULL,
      phone='', address='', comuna='', region='', company_name='', company_rut='', company_giro='', company_address='' WHERE id=?`,
      `eliminado-${userId}@anonimo.invalid`, '!' + randomBytes(16).toString('hex'), userId);
    await run('DELETE FROM sessions WHERE user_id=?', userId);
    await run('DELETE FROM password_resets WHERE user_id=?', userId);
    await run('DELETE FROM notifications WHERE user_id=?', userId);
    return {
      anonimizado: ['nombre', 'correo', 'RUN', 'contraseña', 'teléfono', 'domicilio', 'datos de empresa', 'sesiones', 'notificaciones'],
      conservado: ['trámites, documentos y adjuntos ya cerrados', 'pagos y órdenes', 'evidencia de firma electrónica', 'registro de auditoría']
    };
  }

  function mountPublic(app) {
    app.get('/api/privacidad/politica', (req, res) => res.json(politica()));
  }

  function mountPrivate(app) {
    app.post('/api/privacidad/aceptar', async (req, res) => {
      if (req.body?.version !== VERSION) v.fail(400, 'VALIDATION_ERROR', 'Versión del aviso de privacidad desactualizada. Recarga la página.');
      await atomic(async () => {
        await run('UPDATE users SET privacy_version=?, privacy_accepted_at=? WHERE id=?', VERSION, now(), req.user.id);
        await audit(req.user.id, 'privacidad.aceptacion', 'usuario', req.user.id, { version: VERSION });
      });
      res.sendStatus(204);
    });

    app.get('/api/privacidad/mis-datos', async (req, res) => {
      const u = req.user;
      const out = {
        generadoEn: now(), formato: 'application/json',
        perfil: { id: u.id, nombre: u.name, correo: u.email, run: u.run, rol: u.role, creadoEn: u.created_at,
          telefono: u.phone, domicilio: u.address, comuna: u.comuna, region: u.region,
          empresa: { razonSocial: u.company_name, rut: u.company_rut, giro: u.company_giro, domicilio: u.company_address },
          avisoPrivacidad: { version: u.privacy_version, aceptadoEn: u.privacy_accepted_at } }
      };
      if (u.role === 'cliente') {
        const cases = await all('SELECT id,folio,service_name,title,details,amount,status,created_at,updated_at FROM cases WHERE client_id=? ORDER BY id', u.id);
        const inIds = cases.length ? cases.map(c => c.id) : [0];
        const marks = inIds.map(() => '?').join(',');
        out.tramites = [];
        const docs = await all(`SELECT case_id,version,content,created_at FROM documents WHERE case_id IN (${marks}) ORDER BY case_id,version`, ...inIds);
        const files = await all(`SELECT case_id,name,sha256,created_at FROM attachments WHERE case_id IN (${marks}) ORDER BY id`, ...inIds);
        const pays = await all(`SELECT case_id,amount,method,reference,status,created_at FROM payments WHERE case_id IN (${marks}) ORDER BY id`, ...inIds);
        const sigs = await all(`SELECT r.case_id,r.id AS solicitud,r.level,r.status,r.created_at,r.completed_at,r.document_sha256,s.name,s.capacity,s.status AS firma,s.signed_at
          FROM signature_requests r JOIN signatories s ON s.request_id=r.id WHERE r.case_id IN (${marks}) ORDER BY r.id,s.id`, ...inIds);
        for (const c of cases) out.tramites.push({ ...c, documentos: docs.filter(d => d.case_id === c.id).map(({ case_id, ...d }) => d),
          adjuntos: files.filter(f => f.case_id === c.id).map(({ case_id, ...f }) => f), pagos: pays.filter(p => p.case_id === c.id).map(({ case_id, ...p }) => p),
          firmas: sigs.filter(s => s.case_id === c.id).map(({ case_id, ...s }) => s) });
        out.ordenes = await all('SELECT buy_order,subtotal,discount,total,coupon_code,status,card_last4,payment_type,installments,created_at FROM orders WHERE client_id=? ORDER BY id', u.id);
      }
      out.notificaciones = await all('SELECT message,read_at,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 500', u.id);
      out.solicitudesDeDatos = await all('SELECT id,type,detail,status,created_at,due_at,resolved_at,resolution FROM data_requests WHERE user_id=? ORDER BY id', u.id);
      out.actividad = await all('SELECT action,entity,entity_id,created_at FROM audit WHERE actor_id=? ORDER BY id DESC LIMIT 1000', u.id);
      await audit(u.id, 'privacidad.exportacion', 'usuario', u.id);
      res.set('Content-Disposition', 'attachment; filename="mis-datos.json"');
      res.type('application/json').send(JSON.stringify(out, null, 2));
    });

    app.get('/api/privacidad/solicitudes', async (req, res) => {
      const { limit, offset } = v.pagination(req.query);
      const todas = req.user.role === 'admin' && req.query.todas === '1';
      const items = await all(`SELECT d.*, u.name AS user_name, u.email AS user_email FROM data_requests d JOIN users u ON u.id=d.user_id
        ${todas ? '' : 'WHERE d.user_id=?'} ORDER BY (d.status IN ('recibida','en_proceso')) DESC, d.due_at ASC LIMIT ? OFFSET ?`,
        ...(todas ? [] : [req.user.id]), limit, offset);
      res.json({ items });
    });

    app.post('/api/privacidad/solicitudes', async (req, res) => {
      const type = req.body?.type;
      if (!TIPOS.includes(type)) v.fail(400, 'VALIDATION_ERROR', `type: use ${TIPOS.join(', ')}.`);
      const detail = v.text(req.body?.detail || '', 'detail', 2000, 0);
      const id = await atomic(async () => {
        await one('SELECT id FROM users WHERE id=? FOR UPDATE', req.user.id);
        if (await one(`SELECT id FROM data_requests WHERE user_id=? AND type=? AND status IN ('recibida','en_proceso')`, req.user.id, type))
          v.fail(409, 'DUPLICATE', 'Ya tienes una solicitud abierta de este tipo.');
        const due = new Date(Date.now() + DIAS(PLAZO_DIAS)).toISOString();
        const requestId = await insert('INSERT INTO data_requests(user_id,type,detail,created_at,due_at) VALUES(?,?,?,?,?)', req.user.id, type, detail, now(), due);
        if (type === 'bloqueo') await run('UPDATE users SET blocked_until=? WHERE id=?', due, req.user.id);
        await audit(req.user.id, 'privacidad.solicitud', 'solicitud_datos', requestId, { type });
        for (const a of await all("SELECT id FROM users WHERE role='admin' AND active=1")) await notify(a.id, null, `Nueva solicitud de datos personales (${type}). Plazo legal: ${due.slice(0, 10)}.`);
        return requestId;
      });
      res.status(201).json(await one('SELECT * FROM data_requests WHERE id=?', id));
    });

    app.patch('/api/privacidad/solicitudes/:id', roles('admin'), async (req, res) => {
      const requestId = v.id(req.params.id), b = req.body || {};
      let applied = null;
      await atomic(async () => {
        const r = await one('SELECT * FROM data_requests WHERE id=? FOR UPDATE', requestId);
        if (!r) v.fail(404, 'NOT_FOUND', 'Solicitud no encontrada.');
        if (!ABIERTO.includes(r.status)) v.fail(409, 'ALREADY_CLOSED', 'La solicitud ya está cerrada.');
        let due = r.due_at, extended = r.extended;
        if (b.extend === true) {
          if (r.extended) v.fail(409, 'ALREADY_EXTENDED', 'El plazo solo se puede prorrogar una vez.');
          due = new Date(Date.parse(r.due_at) + DIAS(PLAZO_DIAS)).toISOString(); extended = 1;
        }
        const status = b.status === undefined ? r.status : b.status;
        if (b.status !== undefined && !['en_proceso', 'resuelta', 'rechazada'].includes(status)) v.fail(400, 'VALIDATION_ERROR', 'status: en_proceso, resuelta o rechazada.');
        const closing = ['resuelta', 'rechazada'].includes(status);
        const resolution = closing ? v.text(b.resolution, 'resolution', 2000, 10) : null;   // un rechazo también debe ser fundado
        if (closing && b.apply === true && status === 'resuelta' && r.type === 'supresion') applied = await anonymize(r.user_id);
        await run('UPDATE data_requests SET status=?, due_at=?, extended=?, resolved_at=?, resolved_by=?, resolution=? WHERE id=?',
          status, due, extended, closing ? now() : null, closing ? req.user.id : null, resolution, requestId);
        if (closing && r.type === 'bloqueo') await run('UPDATE users SET blocked_until=NULL WHERE id=?', r.user_id);
        await audit(req.user.id, 'privacidad.solicitud_actualizada', 'solicitud_datos', requestId, { type: r.type, status, extended: Boolean(b.extend), anonymized: Boolean(applied) });
        if (!applied) await notify(r.user_id, null, `Tu solicitud de datos personales (${r.type}) está ${status.replace('_', ' ')}.${resolution ? ' ' + resolution : ''}`);
      });
      res.json({ ...(await one('SELECT * FROM data_requests WHERE id=?', requestId)), supresion: applied });
    });

    app.get('/api/incidentes', roles('admin'), async (req, res) => {
      const { limit, offset } = v.pagination(req.query);
      res.json({ items: await all('SELECT * FROM security_incidents ORDER BY id DESC LIMIT ? OFFSET ?', limit, offset) });
    });
    app.post('/api/incidentes', roles('admin'), async (req, res) => {
      const b = req.body || {};
      const people = b.peopleAffected === undefined ? null : v.integer(b.peopleAffected, 'peopleAffected', 0, 1000000000);
      const id = await atomic(async () => {
        const incidentId = await insert('INSERT INTO security_incidents(detected_at,description,data_affected,people_affected,measures,created_by) VALUES(?,?,?,?,?,?)',
          b.detectedAt === undefined ? now() : iso('detectedAt', b.detectedAt), v.text(b.description, 'description', 4000), v.text(b.dataAffected || '', 'dataAffected', 2000, 0),
          people, v.text(b.measures || '', 'measures', 4000, 0), req.user.id);
        await audit(req.user.id, 'incidente.registrado', 'incidente', incidentId);
        return incidentId;
      });
      res.status(201).json(await one('SELECT * FROM security_incidents WHERE id=?', id));
    });
    app.patch('/api/incidentes/:id', roles('admin'), async (req, res) => {
      const incidentId = v.id(req.params.id), b = req.body || {};
      const row = await one('SELECT * FROM security_incidents WHERE id=?', incidentId);
      if (!row) v.fail(404, 'NOT_FOUND', 'Incidente no encontrado.');
      const status = b.status === undefined ? row.status : b.status;
      if (!['abierto', 'contenido', 'cerrado'].includes(status)) v.fail(400, 'VALIDATION_ERROR', 'status: abierto, contenido o cerrado.');
      await atomic(async () => {
        await run('UPDATE security_incidents SET status=?, measures=?, reported_to_agency_at=?, notified_people_at=? WHERE id=?', status,
          b.measures === undefined ? row.measures : v.text(b.measures, 'measures', 4000, 0),
          b.reportedToAgencyAt === undefined ? row.reported_to_agency_at : iso('reportedToAgencyAt', b.reportedToAgencyAt),
          b.notifiedPeopleAt === undefined ? row.notified_people_at : iso('notifiedPeopleAt', b.notifiedPeopleAt), incidentId);
        await audit(req.user.id, 'incidente.actualizado', 'incidente', incidentId, { status });
      });
      res.json(await one('SELECT * FROM security_incidents WHERE id=?', incidentId));
    });
  }

  return { mountPublic, mountPrivate };
}

module.exports = { createPrivacidad, VERSION };
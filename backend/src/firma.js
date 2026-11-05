// Firma electrónica (Ley 19.799). Nivel "simple": la emite esta plataforma (enlace único + código al correo + nombre escrito
// + hash SHA-256 del documento congelado + evidencia). Nivel "avanzada": requiere prestador acreditado -> 503 hasta integrarlo.
const { randomInt } = require('node:crypto');
const v = require('./validation');
const { hashPassword, verifyPassword, digest, token } = require('./security');
const { documentoFirmadoPdf } = require('./pdf');

const DECLARACION_VERSION = 'FES-2026-1';
const DECLARACION = 'Declaro que soy la persona individualizada, que leí el documento completo y que mi firma electrónica simple, ' +
  'regulada por la Ley N.º 19.799, expresa mi voluntad de obligarme por su contenido.';
const VIGENCIA_DIAS = 7, OTP_MINUTOS = 10, OTP_INTENTOS = 5, OTP_REENVIO_SEG = 60, MAX_FIRMANTES = 10;

const normaliza = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const maskRun = run => { const [c, dv] = String(run).split('-'); return c ? `${c.slice(0, -3).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}.***-${dv}` : ''; };
const maskEmail = e => { const [u, d] = String(e).split('@'); return u && d ? `${u.slice(0, 2)}***@${d}` : ''; };

function createFirma({ run, insert, one, all, atomic, audit, notify, roles, caseFor, changeState, mailer, frontendUrl, now, provider = {} }) {
  const avanzadaDisponible = Boolean(provider.enabled);

  const limiter = (prefix, max) => async (req, res, next) => {
    const key = digest(`${prefix}:${req.ip || 'unknown'}`), time = Date.now();
    await run('DELETE FROM login_attempts WHERE reset_at <= ?', time);
    const row = await one('SELECT * FROM login_attempts WHERE key=?', key);
    if (row && row.count >= max) {
      res.set('Retry-After', String(Math.ceil((row.reset_at - time) / 1000)));
      return next(new v.ApiError(429, 'RATE_LIMIT', 'Demasiados intentos. Intenta más tarde.'));
    }
    await run('INSERT INTO login_attempts(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=login_attempts.count+1', key, time + 15 * 60 * 1000);
    next();
  };
  const publicLimit = limiter('firma', 60), otpLimit = limiter('firma-otp', 10);

  const present = (request, signatories) => ({
    id: request.id, status: request.status, level: request.level, provider: request.provider,
    documentSha256: request.document_sha256, signedSha256: request.signed_sha256 || null,
    createdAt: request.created_at, expiresAt: new Date(Number(request.expires_at)).toISOString(), completedAt: request.completed_at,
    signatories: signatories.map(s => ({ id: s.id, name: s.name, run: maskRun(s.run), email: maskEmail(s.email), capacity: s.capacity, status: s.status, signedAt: s.signed_at }))
  });
  const latestRequest = caseId => one('SELECT * FROM signature_requests WHERE case_id=? ORDER BY id DESC LIMIT 1', caseId);
  const signatoriesOf = requestId => all('SELECT * FROM signatories WHERE request_id=? ORDER BY id', requestId);

  const expireIfNeeded = async request => {
    if (!request || request.status !== 'pendiente' || Number(request.expires_at) > Date.now()) return request;
    await atomic(async () => {
      const locked = await one('SELECT * FROM signature_requests WHERE id=? FOR UPDATE', request.id);
      if (locked.status !== 'pendiente') return;
      await run("UPDATE signature_requests SET status='expirada' WHERE id=?", request.id);
      const row = await one('SELECT * FROM cases WHERE id=? FOR UPDATE', request.case_id);
      if (row.status === 'pendiente_firma') await changeState({}, row, 'aprobado', 'La solicitud de firma venció.');
      await audit(null, 'firma.expirada', 'tramite', request.case_id, { requestId: request.id });
    });
    return one('SELECT * FROM signature_requests WHERE id=?', request.id);
  };

  const link = tokenValue => `${frontendUrl}/firmar/${tokenValue}`;
  const sendInvite = (c, s, tokenValue) => mailer.send({
    to: s.email, subject: `Firma del documento ${c.folio}: ${c.service_name}`,
    text: `Hola ${s.name}:\n\nSe te solicitó firmar electrónicamente el documento "${c.service_name}" (trámite ${c.folio}).\n\n` +
      `Revísalo y fírmalo aquí (vence en ${VIGENCIA_DIAS} días):\n${link(tokenValue)}\n\n` +
      `Si no esperabas este mensaje, ignóralo: nadie puede firmar por ti sin el código que te llegará a este correo.`
  }).catch(e => console.error('No se pudo enviar la invitación de firma:', e.message));

  function mountPrivate(app) {
    app.get('/api/tramites/:id/firma', roles('admin', 'comercial', 'cliente'), async (req, res) => {
      const row = await caseFor(req);
      const request = await expireIfNeeded(await latestRequest(row.id));
      const client = await one('SELECT name,run,email FROM users WHERE id=?', row.client_id);
      res.json({
        requiresSignature: Boolean(row.requires_signature), level: row.signature_level,
        availableLevels: { simple: true, avanzada: avanzadaDisponible },
        declaration: { version: DECLARACION_VERSION, text: DECLARACION },
        suggested: client ? { name: client.name, run: client.run, email: client.email } : null,
        request: request ? present(request, await signatoriesOf(request.id)) : null
      });
    });

    app.post('/api/tramites/:id/firma', roles('admin', 'comercial', 'cliente'), async (req, res) => {
      const row = await caseFor(req, true);
      if (row.status !== 'aprobado' || !row.requires_signature) v.fail(409, 'INVALID_STATE', 'Requiere un trámite aprobado con firma requerida.');
      if (row.signature_level === 'avanzada' && !avanzadaDisponible)
        v.fail(503, 'SIGNATURE_NOT_CONFIGURED', 'Este servicio exige firma electrónica avanzada y falta integrar un prestador acreditado. No se ha firmado ni enviado el documento.');
      const list = req.body?.signatories;
      if (!Array.isArray(list) || !list.length || list.length > MAX_FIRMANTES) v.fail(400, 'VALIDATION_ERROR', `signatories: entre 1 y ${MAX_FIRMANTES} firmantes.`);
      const seen = new Set();
      const signers = list.map((raw, i) => {
        if (!raw || typeof raw !== 'object') v.fail(400, 'VALIDATION_ERROR', `signatories[${i}]: objeto requerido.`);
        const s = { name: v.text(raw.name, `signatories[${i}].name`, 120), run: v.run(v.text(raw.run, `signatories[${i}].run`, 15)),
          email: v.email(raw.email), capacity: v.text(raw.capacity || '', `signatories[${i}].capacity`, 120, 0) };
        if (seen.has(s.run) || seen.has(s.email)) v.fail(400, 'VALIDATION_ERROR', 'Cada firmante debe tener un RUN y un correo distintos.');
        seen.add(s.run); seen.add(s.email);
        return s;
      });
      const invitations = [];
      const requestId = await atomic(async () => {
        const locked = await one('SELECT * FROM cases WHERE id=? FOR UPDATE', row.id);
        if (locked.status !== 'aprobado') v.fail(409, 'STATE_CHANGED', 'El trámite cambió. Vuelve a cargarlo.');
        const doc = await one('SELECT * FROM documents WHERE case_id=? ORDER BY version DESC LIMIT 1', row.id);
        if (!doc) v.fail(409, 'DOCUMENT_REQUIRED', 'El trámite no tiene documento.');
        const id = await insert("INSERT INTO signature_requests(case_id,document_id,document_sha256,level,status,created_by,created_at,expires_at) VALUES(?,?,?,?,'pendiente',?,?,?)",
          row.id, doc.id, digest(doc.content), 'simple', req.user.id, now(), Date.now() + VIGENCIA_DIAS * 86400000);
        for (const s of signers) {
          const t = token();
          await insert('INSERT INTO signatories(request_id,name,run,email,capacity,token_hash) VALUES(?,?,?,?,?,?)', id, s.name, s.run, s.email, s.capacity, digest(t));
          invitations.push([s, t]);
        }
        await changeState(req, locked, 'pendiente_firma');
        await audit(req.user.id, 'firma.solicitada', 'tramite', row.id, { requestId: id, signatories: signers.length, documentVersion: doc.version });
        return id;
      });
      for (const [s, t] of invitations) sendInvite(row, s, t);
      const request = await one('SELECT * FROM signature_requests WHERE id=?', requestId);
      res.status(201).json(present(request, await signatoriesOf(requestId)));
    });

    app.post('/api/tramites/:id/firma/cancelar', roles('admin', 'comercial', 'cliente'), async (req, res) => {
      const row = await caseFor(req, true);
      await atomic(async () => {
        const locked = await one('SELECT * FROM cases WHERE id=? FOR UPDATE', row.id);
        const request = await one("SELECT * FROM signature_requests WHERE case_id=? AND status='pendiente' FOR UPDATE", row.id);
        if (!request || locked.status !== 'pendiente_firma') v.fail(409, 'INVALID_STATE', 'No hay una firma pendiente para cancelar.');
        if (await one("SELECT id FROM signatories WHERE request_id=? AND status='firmado' LIMIT 1", request.id))
          v.fail(409, 'ALREADY_PARTIALLY_SIGNED', 'Alguien ya firmó esta versión; no se puede cancelar.');
        await run("UPDATE signature_requests SET status='cancelada' WHERE id=?", request.id);
        await changeState(req, locked, 'aprobado', 'Solicitud de firma cancelada.');
        await audit(req.user.id, 'firma.cancelada', 'tramite', row.id, { requestId: request.id });
      });
      res.sendStatus(204);
    });

    app.get('/api/tramites/:id/firma/documento', roles('admin', 'comercial', 'cliente'), async (req, res) => {
      const row = await caseFor(req);
      const request = await one("SELECT * FROM signature_requests WHERE case_id=? AND status='completada' ORDER BY id DESC LIMIT 1", row.id);
      if (!request) v.fail(404, 'NOT_FOUND', 'El documento aún no está firmado.');
      await audit(req.user.id, 'firma.descarga', 'tramite', row.id, { requestId: request.id });
      res.set('Content-Disposition', `attachment; filename="${row.folio}-firmado.pdf"`);
      res.type('application/pdf').send(Buffer.from(request.signed_pdf));
    });
  }

  async function signerFor(tokenValue, { forUpdate = false } = {}) {
    if (!/^[a-f0-9]{64}$/.test(String(tokenValue))) v.fail(404, 'NOT_FOUND', 'Enlace de firma inválido.');
    const s = await one(`SELECT * FROM signatories WHERE token_hash=?${forUpdate ? ' FOR UPDATE' : ''}`, digest(tokenValue));
    if (!s) v.fail(404, 'NOT_FOUND', 'Enlace de firma inválido.');
    let request = await one('SELECT * FROM signature_requests WHERE id=?', s.request_id);
    request = await expireIfNeeded(request);
    return { s: forUpdate ? await one('SELECT * FROM signatories WHERE id=? FOR UPDATE', s.id) : s, request };
  }

  function mountPublic(app) {
    app.get('/api/firma/verificar/:sha256', publicLimit, async (req, res) => {
      const sha = String(req.params.sha256).toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(sha)) v.fail(400, 'VALIDATION_ERROR', 'Huella SHA-256 inválida.');
      const r = await one("SELECT r.completed_at, r.level, c.folio FROM signature_requests r JOIN cases c ON c.id=r.case_id WHERE r.signed_sha256=? AND r.status='completada'", sha);
      res.json(r ? { valida: true, folio: r.folio, nivel: r.level, firmadoEn: r.completed_at } : { valida: false });
    });

    app.get('/api/firma/:token', publicLimit, async (req, res) => {
      const { s, request } = await signerFor(req.params.token);
      const c = await one('SELECT folio,service_name FROM cases WHERE id=?', request.case_id);
      const doc = await one('SELECT content,version FROM documents WHERE id=?', request.document_id);
      res.json({
        folio: c.folio, servicio: c.service_name, documentVersion: doc.version, documentSha256: request.document_sha256,
        signer: { name: s.name, run: maskRun(s.run), capacity: s.capacity, status: s.status },
        request: { status: request.status, level: request.level, expiresAt: new Date(Number(request.expires_at)).toISOString() },
        declaration: { version: DECLARACION_VERSION, text: DECLARACION },
        content: request.status === 'pendiente' || s.status === 'firmado' ? doc.content : null
      });
    });

    app.post('/api/firma/:token/codigo', publicLimit, otpLimit, async (req, res) => {
      const { s, request } = await signerFor(req.params.token);
      if (request.status !== 'pendiente' || s.status !== 'pendiente') v.fail(409, 'NOT_PENDING', 'Esta firma ya no está disponible.');
      const sentAgo = s.otp_expires_at ? OTP_MINUTOS * 60 - Math.floor((Number(s.otp_expires_at) - Date.now()) / 1000) : Infinity;
      if (sentAgo < OTP_REENVIO_SEG) v.fail(429, 'RATE_LIMIT', `Espera ${OTP_REENVIO_SEG - sentAgo} segundos para pedir otro código.`);
      const code = String(randomInt(0, 1000000)).padStart(6, '0');
      const codeHash = await hashPassword(code);
      await atomic(async () => {
        await run('UPDATE signatories SET otp_hash=?, otp_expires_at=?, otp_attempts=0 WHERE id=?', codeHash, Date.now() + OTP_MINUTOS * 60 * 1000, s.id);
        await audit(null, 'firma.codigo_enviado', 'tramite', request.case_id, { requestId: request.id, signatoryId: s.id });
      });
      mailer.send({
        to: s.email, subject: `Tu código para firmar: ${code}`,
        text: `Hola ${s.name}:\n\nTu código para firmar el documento es: ${code}\n\nVence en ${OTP_MINUTOS} minutos. No lo compartas con nadie.`
      }).catch(e => console.error('No se pudo enviar el código de firma:', e.message));
      res.json({ message: 'Te enviamos un código al correo registrado.', email: maskEmail(s.email) });
    });

    app.post('/api/firma/:token/firmar', publicLimit, async (req, res) => {
      const b = req.body || {};
      const code = typeof b.code === 'string' ? b.code.trim() : '';
      if (!/^\d{6}$/.test(code)) v.fail(400, 'INVALID_CODE', 'Ingresa el código de 6 dígitos.');
      if (b.accept !== true) v.fail(400, 'DECLARATION_REQUIRED', 'Debes aceptar la declaración para firmar.');
      const typed = v.text(b.typedName, 'typedName', 120);
      const first = await signerFor(req.params.token);
      if (first.request.status !== 'pendiente') v.fail(409, 'NOT_PENDING', 'Esta firma ya no está disponible.');
      if (first.s.status !== 'pendiente') v.fail(409, 'ALREADY_SIGNED', 'Ya firmaste este documento.');
      if (normaliza(typed) !== normaliza(first.s.name)) v.fail(400, 'NAME_MISMATCH', 'El nombre escrito no coincide con el del firmante.');
      const reset = first.s;
      if (!reset.otp_hash || Number(reset.otp_expires_at) < Date.now() || reset.otp_attempts >= OTP_INTENTOS)
        v.fail(400, 'INVALID_CODE', 'El código no es válido o venció. Pide uno nuevo.');
      if (!await verifyPassword(code, reset.otp_hash)) {
        await run('UPDATE signatories SET otp_attempts=otp_attempts+1 WHERE id=?', reset.id);
        v.fail(400, 'INVALID_CODE', 'El código no es válido o venció. Pide uno nuevo.');
      }
      const ip = String(req.ip || '').slice(0, 64), ua = String(req.get('User-Agent') || '').slice(0, 300);
      let completed = null;
      await atomic(async () => {
        const { s, request } = await signerFor(req.params.token, { forUpdate: true });
        const lockedRequest = await one('SELECT * FROM signature_requests WHERE id=? FOR UPDATE', request.id);
        if (lockedRequest.status !== 'pendiente') v.fail(409, 'NOT_PENDING', 'Esta firma ya no está disponible.');
        if (s.status !== 'pendiente') v.fail(409, 'ALREADY_SIGNED', 'Ya firmaste este documento.');
        if (!(await run("UPDATE signatories SET status='firmado', signed_at=?, signed_ip=?, signed_user_agent=?, typed_name=?, declaration_version=?, otp_hash=NULL, otp_expires_at=NULL WHERE id=? AND status='pendiente'",
          now(), ip, ua, typed, DECLARACION_VERSION, s.id)).changes) v.fail(409, 'ALREADY_SIGNED', 'Ya firmaste este documento.');
        await audit(null, 'firma.firmado', 'tramite', lockedRequest.case_id, { requestId: lockedRequest.id, signatoryId: s.id });
        const pending = await one("SELECT COUNT(*) AS n FROM signatories WHERE request_id=? AND status<>'firmado'", lockedRequest.id);
        if (pending.n > 0) return;
        const row = await one('SELECT * FROM cases WHERE id=? FOR UPDATE', lockedRequest.case_id);
        const doc = await one('SELECT * FROM documents WHERE id=?', lockedRequest.document_id);
        if (digest(doc.content) !== lockedRequest.document_sha256) v.fail(409, 'DOCUMENT_CHANGED', 'El documento cambió después de solicitar la firma.');
        const firmantes = await signatoriesOf(lockedRequest.id);
        const pdf = await documentoFirmadoPdf({
          folio: row.folio, version: doc.version, servicio: row.service_name, contenido: doc.content, creadoEn: doc.created_at,
          solicitudId: lockedRequest.id, nivel: lockedRequest.level, huellaDocumento: lockedRequest.document_sha256,
          declaracion: { version: DECLARACION_VERSION, texto: DECLARACION },
          firmantes: firmantes.map(f => ({ nombre: f.name, run: f.run, correo: f.email, calidad: f.capacity, firmadoEn: f.signed_at, ip: f.signed_ip, navegador: f.signed_user_agent }))
        });
        const signedSha = digest(pdf);
        await run("UPDATE signature_requests SET status='completada', completed_at=?, signed_pdf=?, signed_sha256=? WHERE id=?", now(), pdf, signedSha, lockedRequest.id);
        await changeState({}, row, 'firmado');
        await audit(null, 'firma.completada', 'tramite', row.id, { requestId: lockedRequest.id, signedSha256: signedSha });
        if (row.assigned_id) await notify(row.assigned_id, row.id, `El trámite ${row.folio} fue firmado por todos los firmantes.`);
        completed = { signedSha256: signedSha };
      });
      res.json({ ok: true, completed: Boolean(completed), signedSha256: completed?.signedSha256 || null });
    });

    app.post('/api/firma/:token/rechazar', publicLimit, async (req, res) => {
      const reason = v.text(req.body?.reason || '', 'reason', 500, 0);
      await atomic(async () => {
        const { s, request } = await signerFor(req.params.token, { forUpdate: true });
        const lockedRequest = await one('SELECT * FROM signature_requests WHERE id=? FOR UPDATE', request.id);
        if (lockedRequest.status !== 'pendiente' || s.status !== 'pendiente') v.fail(409, 'NOT_PENDING', 'Esta firma ya no está disponible.');
        await run("UPDATE signatories SET status='rechazado', reject_reason=?, otp_hash=NULL WHERE id=?", reason, s.id);
        await run("UPDATE signature_requests SET status='cancelada' WHERE id=?", lockedRequest.id);
        const row = await one('SELECT * FROM cases WHERE id=? FOR UPDATE', lockedRequest.case_id);
        if (row.status === 'pendiente_firma') await changeState({}, row, 'aprobado', 'Un firmante rechazó firmar.');
        await audit(null, 'firma.rechazada', 'tramite', row.id, { requestId: lockedRequest.id, signatoryId: s.id });
        if (row.assigned_id) await notify(row.assigned_id, row.id, `${s.name} rechazó firmar el trámite ${row.folio}.${reason ? ' Motivo: ' + reason : ''}`);
      });
      res.sendStatus(204);
    });

    app.get('/api/firma/:token/documento', publicLimit, async (req, res) => {
      const { s, request } = await signerFor(req.params.token);
      if (request.status !== 'completada' || s.status !== 'firmado') v.fail(404, 'NOT_FOUND', 'El documento firmado aún no está disponible.');
      const c = await one('SELECT folio FROM cases WHERE id=?', request.case_id);
      await audit(null, 'firma.descarga_firmante', 'tramite', request.case_id, { requestId: request.id, signatoryId: s.id });
      res.set('Content-Disposition', `attachment; filename="${c.folio}-firmado.pdf"`);
      res.type('application/pdf').send(Buffer.from(request.signed_pdf));
    });
  }

  return { mountPublic, mountPrivate, DECLARACION_VERSION };
}

module.exports = { createFirma, DECLARACION_VERSION };
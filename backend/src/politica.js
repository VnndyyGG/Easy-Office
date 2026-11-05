// Describe SOLO lo que el sistema hace hoy. Los datos de la empresa vienen del entorno (no se inventan).
const VERSION = '2026.1';
const VIGENTE_DESDE = '2026-10-31';

function politica(env = process.env) {
  const dato = (valor, etiqueta) => (valor && valor.trim() ? { valor: valor.trim() } : { valor: `[Completar: ${etiqueta}]`, pendiente: true });
  const responsable = {
    nombre: dato(env.PRIVACY_CONTROLLER_NAME, 'razón social del responsable'),
    rut: dato(env.PRIVACY_CONTROLLER_RUT, 'RUT de la empresa'),
    domicilio: dato(env.PRIVACY_CONTROLLER_ADDRESS, 'domicilio'),
    contacto: dato(env.PRIVACY_CONTACT_EMAIL, 'correo para ejercer derechos'),
    delegado: dato(env.PRIVACY_DPO_EMAIL, 'delegado de protección de datos, si se designa')
  };
  return {
    version: VERSION, vigenteDesde: VIGENTE_DESDE, responsable, revisionLegalPendiente: true,
    datos: [
      { categoria: 'Identificación y contacto', detalle: 'Nombre, RUN, correo electrónico y contraseña (se guarda solo su huella criptográfica).' },
      { categoria: 'Contenido de los trámites', detalle: 'Los documentos que redactas y los PDF que adjuntas. Pueden incluir datos de otras personas (nombre, RUN, domicilio, estado civil, nacionalidad): ingrésalos solo si cuentas con su autorización o con un fundamento legal para hacerlo.' },
      { categoria: 'Pagos', detalle: 'Monto, orden, código de autorización y últimos 4 dígitos de la tarjeta. El número completo de la tarjeta lo procesa Transbank y no se almacena aquí.' },
      { categoria: 'Firma electrónica', detalle: 'Nombre, RUN y correo de cada firmante, fecha y hora de la firma, dirección IP y navegador, como evidencia de quién firmó y cuándo.' },
      { categoria: 'Uso del sistema', detalle: 'Registro de acciones (inicios de sesión, consultas y cambios de estado) para seguridad y trazabilidad. No guarda contraseñas ni el contenido de los documentos.' }
    ],
    finalidades: [
      { finalidad: 'Prestarte el servicio contratado: redactar, revisar, firmar y entregar documentos, y gestionar su pago.', base: 'Ejecución del contrato' },
      { finalidad: 'Cumplir obligaciones legales, por ejemplo de carácter tributario o de conservación de antecedentes de pago.', base: 'Obligación legal' },
      { finalidad: 'Mantener la seguridad del sistema, prevenir fraudes y poder acreditar quién hizo qué.', base: 'Interés legítimo' },
      { finalidad: 'Responder tus solicitudes de derechos y reclamos.', base: 'Obligación legal' }
    ],
    destinatarios: [
      { quien: 'Transbank (Webpay)', para: 'Procesar el pago con tarjeta.', fuera_de_chile: false },
      { quien: 'Proveedor de correo (SMTP) configurado por la empresa', para: 'Enviar códigos, avisos y enlaces de firma.', fuera_de_chile: null },
      { quien: 'Photon (OpenStreetMap / Komoot), o el servicio equivalente que configure la empresa', para: 'Sugerir direcciones mientras escribes. Se envía el texto parcial de la dirección, no tu identidad. El servicio público opera fuera de Chile (transferencia internacional).', fuera_de_chile: true },
      { quien: 'Ejecutivos de Easy Office', para: 'Atender tus trámites. Cada ejecutivo accede solo a lo que su rol permite.', fuera_de_chile: false }
    ],
    conservacion: 'Mientras tengas una cuenta o un trámite vigente y, después, por los plazos que exijan las normas aplicables o la defensa de reclamaciones. Cumplido el plazo se eliminan o anonimizan. [El calendario de conservación por tipo de dato debe ser definido por la empresa.]',
    derechos: [
      { derecho: 'Acceso', detalle: 'Saber qué datos tuyos tratamos y recibir una copia.' },
      { derecho: 'Rectificación', detalle: 'Corregir datos inexactos o incompletos.' },
      { derecho: 'Supresión', detalle: 'Pedir que eliminemos tus datos cuando proceda. Podemos conservar los que la ley nos obliga a mantener o que necesitamos para defender reclamaciones.' },
      { derecho: 'Oposición', detalle: 'Oponerte a un tratamiento basado en interés legítimo.' },
      { derecho: 'Portabilidad', detalle: 'Recibir tus datos en un formato estructurado y de uso común.' },
      { derecho: 'Bloqueo', detalle: 'Suspender temporalmente el tratamiento mientras se resuelve una solicitud de rectificación, supresión u oposición.' }
    ],
    plazos: 'Respondemos por escrito dentro de 30 días corridos. Por una sola vez podemos prorrogar el plazo hasta por otros 30 días corridos, avisándote el motivo. Si denegamos tu solicitud, explicamos por qué.',
    canal: 'Desde tu cuenta, en “Mi privacidad”, o escribiendo al correo del responsable indicado arriba.',
    reclamo: 'Si no estás conforme con la respuesta, puedes reclamar ante la Agencia de Protección de Datos Personales una vez que ésta esté operativa.',
    seguridad: [
      'Las contraseñas se guardan con una función de derivación de claves (scrypt); nunca en texto legible.',
      'Cada rol ve únicamente los trámites y datos que necesita para su función.',
      'Las sesiones expiran y se pueden revocar; los intentos de acceso están limitados.',
      'Las acciones relevantes quedan en un registro de auditoría que la aplicación no permite modificar ni borrar.'
    ]
  };
}

module.exports = { VERSION, VIGENTE_DESDE, politica };
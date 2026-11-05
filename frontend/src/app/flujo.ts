
export const ESTADOS: Record<string, { label: string; clase: string }> = {
  borrador: { label: 'Borrador', clase: 'redaccion' },
  pendiente_pago: { label: 'Pendiente de pago', clase: 'pendiente' },
  en_redaccion: { label: 'En redacción', clase: 'redaccion' },
  en_revision: { label: 'En revisión', clase: 'redaccion' },
  observado: { label: 'Observado', clase: 'pendiente' },
  aprobado: { label: 'Aprobado', clase: 'aprobado' },
  pendiente_firma: { label: 'Pendiente de firma', clase: 'firma' },
  firmado: { label: 'Firmado', clase: 'completo' },
  entregado: { label: 'Entregado', clase: 'completo' },
  completado: { label: 'Completado', clase: 'completo' },
  cancelado: { label: 'Cancelado', clase: 'rechazado' },
};

export interface Paso {
  clave: string;
  label: string;
  detalle: string;
}

export function pasosDe(requiereFirma: boolean): Paso[] {
  const pasos: Paso[] = [
    { clave: 'redaccion', label: 'Datos del documento', detalle: 'Completas los datos y editas el documento' },
    { clave: 'pago', label: 'Pago', detalle: 'Pago con Webpay desde el carrito' },
    { clave: 'revision', label: 'Revisión', detalle: 'Un ejecutivo revisa el documento' },
    { clave: 'aprobado', label: 'Aprobado', detalle: 'Documento aprobado' },
  ];
  if (requiereFirma) {
    pasos.push({ clave: 'firma', label: 'Firma electrónica', detalle: 'Firma electrónica avanzada (Ley 19.799)' });
  }
  pasos.push({ clave: 'completado', label: 'Completado', detalle: 'Trámite cerrado' });
  return pasos;
}

export function indiceActual(estado: string, requiereFirma: boolean): number {
  const pasos = pasosDe(requiereFirma);
  const indice = (clave: string) => pasos.findIndex(p => p.clave === clave);

  switch (estado) {
    case 'borrador':
      return indice('redaccion');

    case 'pendiente_pago':
      return indice('pago');

    case 'en_redaccion':
    case 'en_revision':
    case 'observado':
      return indice('revision');

    case 'aprobado':
      return requiereFirma ? indice('firma') : indice('completado');

    case 'pendiente_firma':
      return indice('firma');

    case 'firmado':
      return indice('completado');

    case 'entregado':
    case 'completado':
      return pasos.length;

    default:
      return -1;
  }
}

export function clp(n: number): string {
  return '$' + Number(n).toLocaleString('es-CL');
}

export function mensajeError(e: any): string {
  return e?.error?.error?.message || e?.error?.message || 'Ocurrió un error. Intenta nuevamente.';
}
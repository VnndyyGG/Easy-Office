import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { Auth, Rol } from './auth';



const API = 'http://localhost:3000/api';

// ---- Modelos (snake_case = como los devuelve el backend) ----
export interface Tramite {
  id: number;
  folio: string;
  documento: string;
  titulo: string;
  fecha: string;
  estado: string;
  monto: number;
  requiereFirma: boolean;
}
export interface CaseRow {
  id: number; folio: string; service_name: string; title: string; details: string;
  amount: number; requires_signature: number; signature_level: 'ninguna' | 'simple' | 'avanzada'; status: string; created_at: string; updated_at: string;
}
export interface DocumentRow { id: number; version: number; content: string; created_at: string; }
export interface AttachmentRow { id: number; name: string; sha256: string; created_at: string; }
export interface CaseDetail extends CaseRow {
  template_id: number | null; documents: DocumentRow[]; attachments: AttachmentRow[];
  contract_folio: string | null;     // folio del contrato (LF-0153-2026); lo asigna el backend al generar
  prefill: Record<string, string>;   // datos del perfil del cliente para los campos de la plantilla (clave del campo → valor)
}
/** "Mi perfil" del cliente. RUN y correo son de solo lectura. */
export interface Perfil {
  nombre: string; run: string; email: string; telefono: string; domicilio: string; comuna: string; region: string;
  razonSocial: string; rutEmpresa: string; giro: string; domicilioEmpresa: string;
}
export interface Servicio { id: number; name: string; price: number; requires_signature: number; template_id: number | null; }

export type TipoCampo =
  | 'text'
  | 'textarea'
  | 'email'
  | 'number'
  | 'run'
  | 'rut'
  | 'select';

export interface CampoPlantilla {
  key: string; label: string; group?: string; type: TipoCampo; required: boolean;
  placeholder?: string; default?: string; prefill?: string; options?: string[];
}
export interface ArticuloPlantilla { key: string; label: string; text: string; fields: CampoPlantilla[]; }
export interface Plantilla {
  id: number; slug: string | null; name: string; content: string;
  category: string; categoryLabel: string; description: string;
  fields: CampoPlantilla[]; clauses: ArticuloPlantilla[];
}
export interface ArticuloElegido { key: string; values: Record<string, string>; }
export interface PlantillaRender { content: string; missing: string[]; complete: boolean; }
export interface DireccionSugerida { direccion: string; lugares: string[]; etiqueta: string; }
export interface ClienteResultado { id: number; name: string; email: string; run: string; }
export interface CaseResumen { id: number; folio: string; service_name: string; title: string; status: string; assigned_id: number | null; created_at: string; }
export interface Pago { id: number; case_id: number; order_id: number | null; amount: number; method: string; reference: string; status: 'pendiente' | 'aprobado' | 'rechazado'; reason: string | null; }
export interface Notificacion { id: number; case_id: number | null; message: string; created_at: string; }
export interface Capabilities {
  payments: {
    webpay: boolean;
  };
  firmaElectronicaSimple: boolean;
  firmaElectronicaAvanzada: boolean;
  privacidad: {
    version: string;
  };
}
export interface Firmante {
  name: string;
  run: string;
  email: string;
  capacity: string;
}

export interface FirmanteEstado {
  id: number;
  name: string;
  run: string;
  email: string;
  capacity: string;
  status: 'pendiente' | 'firmado' | 'rechazado';
  signedAt: string | null;
}

export interface SolicitudFirma {
  id: number;
  status: 'pendiente' | 'completada' | 'cancelada' | 'expirada';
  level: string;
  documentSha256: string;
  signedSha256: string | null;
  expiresAt: string;
  completedAt: string | null;
  signatories: FirmanteEstado[];
}

export interface FirmaEstado {
  requiresSignature: boolean;
  level: string;
  availableLevels: {
    simple: boolean;
    avanzada: boolean;
  };
  declaration: {
    version: string;
    text: string;
  };
  suggested: {
    name: string;
    run: string;
    email: string;
  } | null;
  request: SolicitudFirma | null;
}

export interface SolicitudDatos {
  id: number;
  user_id: number;
  type: string;
  detail: string;
  status: string;
  created_at: string;
  due_at: string;
  extended: number;
  resolved_at: string | null;
  resolution: string | null;
  user_name?: string;
  user_email?: string;
}
// ---- Carrito, cupones y Webpay ----
export interface CarritoItem { id: number; folio: string; title: string; service_name: string; amount: number; en_proceso: boolean; }
export interface CotizacionItem { case_id: number; amount: number; paid_amount: number; folio: string; title: string; service_name: string; }
export interface Cotizacion { subtotal: number; discount: number; total: number; coupon: { code: string; amount: number } | null; items: CotizacionItem[]; }
export interface OrdenItem { case_id: number; folio: string; title: string; service_name: string; status: string; amount: number; paid_amount: number; }
export interface Orden {
  id: number; buy_order: string; status: 'iniciada' | 'procesando' | 'pagada' | 'rechazada' | 'anulada' | 'expirada';
  subtotal: number; discount: number; total: number; coupon_code: string | null;
  authorization_code: string | null; card_last4: string | null; payment_type: string | null; installments: number | null;
  created_at: string; items: OrdenItem[];
}

@Injectable({ providedIn: 'root' })
export class Tramites {
  constructor(private http: HttpClient, private auth: Auth) { }

  private h() {
    return { headers: new HttpHeaders({ Authorization: `Bearer ${this.auth.token()}` }) };
  }

  // ---- Listado (lo que ya tenías, ahora con id/monto/firma) ----
  getMisTramites(): Observable<Tramite[]> {
    return this.http.get<{ items: CaseRow[] }>(`${API}/tramites`, this.h()).pipe(
      map(res => res.items.map(c => ({
        id: c.id,
        folio: c.folio,
        documento: c.service_name,
        titulo: c.title,
        fecha: c.created_at.slice(0, 10),
        estado: c.status,
        monto: c.amount,
        requiereFirma: !!c.requires_signature,
      })))
    );
  }

  // ---- Catálogo / contexto ----
  getServicios() { return this.http.get<{ items: Servicio[] }>(`${API}/servicios`, this.h()); }
  getPlantillas() {
    return this.http.get<{ items: Plantilla[]; categorias: { key: string; label: string; total: number }[] }>(`${API}/plantillas`, this.h());
  }
  /** El backend valida (RUn, correo, opciones) y devuelve el documento final. No guarda nada. */
  renderPlantilla(id: number, body: { values: Record<string, string>; clauses: ArticuloElegido[] }) {
    return this.http.post<PlantillaRender>(`${API}/plantillas/${id}/render`, body, this.h());
  }
  getCapabilities() { return this.http.get<Capabilities>(`${API}/capabilities`); }
  getPagos() { return this.http.get<{ items: Pago[] }>(`${API}/pagos`, this.h()); }
  getNotificaciones() { return this.http.get<{ items: Notificacion[] }>(`${API}/notificaciones`, this.h()); }

  // ---- Mi perfil ----
  getPerfil() { return this.http.get<Perfil>(`${API}/perfil`, this.h()); }
  guardarPerfil(datos: Partial<Perfil>) { return this.http.patch<Perfil & { perfil: Rol }>(`${API}/perfil`, datos, this.h()); }

  // ---- Trámite ----
  crearTramite(serviceId: number, details = '') {
    return this.http.post<CaseRow>(`${API}/tramites`, { serviceId, details }, this.h());
  }
  getTramite(id: number) { return this.http.get<CaseDetail>(`${API}/tramites/${id}`, this.h()); }
  cambiarEstado(id: number, status: string, reason = '') {
    return this.http.patch<CaseRow>(`${API}/tramites/${id}/estado`, { status, reason }, this.h());
  }
  // ---- Carrito: el servidor calcula siempre los montos; el cliente solo envía qué trámites y el código del cupón ----
  getCarrito() { return this.http.get<{ items: CarritoItem[]; webpay: boolean }>(`${API}/carrito`, this.h()); }
  cotizar(caseIds: number[], coupon = '') { return this.http.post<Cotizacion>(`${API}/carrito/cotizar`, { caseIds, coupon }, this.h()); }
  pagarCarrito(caseIds: number[], coupon = '') {
    return this.http.post<{ orderId: number; url: string; token: string; total: number }>(`${API}/carrito/pagar`, { caseIds, coupon }, this.h());
  }
  getOrden(id: number) { return this.http.get<Orden>(`${API}/ordenes/${id}`, this.h()); }
  asignarFolioContrato(id: number, sucursal: string) {
    return this.http.post<{ folio: string }>(`${API}/tramites/${id}/folio-contrato`, { sucursal }, this.h());
  }
  guardarDocumento(id: number, content: string, expectedVersion: number) {
    return this.http.post<DocumentRow>(`${API}/tramites/${id}/documentos`, { content, expectedVersion }, this.h());
  }
  subirAdjunto(id: number, name: string, base64: string) {
    return this.http.post<{ id: number; name: string }>(`${API}/tramites/${id}/adjuntos`, { name, base64 }, this.h());
  }


  // ---- Ejecutivo comercial: el backend ya filtra a sus trámites asignados ----
  getTramitesAsignados() {
    return this.http.get<{ items: (CaseRow & { client_name: string })[]; total: number }>(`${API}/tramites?limit=100`, this.h());
  }
  buscarClientes(q: string) {
    return this.http.get<{ items: ClienteResultado[] }>(`${API}/clientes`, { ...this.h(), params: { q } });
  }
  buscarDirecciones(q: string) {
    return this.http.get<{ items: DireccionSugerida[] }>(`${API}/direcciones`, { ...this.h(), params: { q } });
  }
  getTramitesDeCliente(id: number) {
    return this.http.get<{ items: CaseResumen[] }>(`${API}/clientes/${id}/tramites`, this.h());
  }

  descargar(ruta: string) {
    return this.http.get(`${API}${ruta}`, { ...this.h(), responseType: 'blob' });
  }

    // ---- Firma electrónica ----

  getFirma(id: number) {
    return this.http.get<FirmaEstado>(
      `${API}/tramites/${id}/firma`,
      this.h()
    );
  }

  iniciarFirma(id: number, signatories: Firmante[]) {
    return this.http.post<SolicitudFirma>(
      `${API}/tramites/${id}/firma`,
      { signatories },
      this.h()
    );
  }

  cancelarFirma(id: number) {
    return this.http.post(
      `${API}/tramites/${id}/firma/cancelar`,
      {},
      this.h()
    );
  }

  // ---- Privacidad y protección de datos ----

  getSolicitudesDatos(todas = false) {
    return this.http.get<{ items: SolicitudDatos[] }>(
      `${API}/privacidad/solicitudes`,
      {
        ...this.h(),
        params: todas ? { todas: '1' } : {}
      }
    );
  }

  crearSolicitudDatos(type: string, detail: string) {
    return this.http.post<SolicitudDatos>(
      `${API}/privacidad/solicitudes`,
      { type, detail },
      this.h()
    );
  }

 resolverSolicitudDatos(id: number, body: { status?: string; resolution?: string; extend?: boolean; apply?: boolean }) {
  return this.http.patch<SolicitudDatos>(`${API}/privacidad/solicitudes/${id}`, body, this.h());
} 
}
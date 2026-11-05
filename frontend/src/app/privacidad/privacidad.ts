import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Auth } from '../auth';
import { SolicitudDatos, Tramites } from '../tramites';
import { mensajeError } from '../flujo';
import { environment } from '../../environments/environment';
const API = environment.apiUrl;

const TIPOS: Record<string, string> = {
  acceso: 'Acceso (saber qué datos tienen de mí)', rectificacion: 'Rectificación (corregir datos)', supresion: 'Supresión (eliminar mis datos)',
  oposicion: 'Oposición a un tratamiento', portabilidad: 'Portabilidad (recibir mis datos)', bloqueo: 'Bloqueo temporal',
};

@Component({ selector: 'app-privacidad', imports: [FormsModule, RouterLink], templateUrl: './privacidad.html', styleUrl: './privacidad.scss' })
export class Privacidad implements OnInit {
  politica = signal<any>(null);
  solicitudes = signal<SolicitudDatos[]>([]);
  error = signal('');
  aviso = signal('');
  ocupado = signal(false);
  tipo = 'acceso';
  detalle = '';
  readonly tipos = Object.entries(TIPOS);
  readonly nombreTipo = (t: string) => TIPOS[t] ?? t;

  constructor(public auth: Auth, private http: HttpClient, private api: Tramites) {}

  get conSesion() { return !!this.auth.currentRole(); }
  get esAdmin() { return this.auth.currentRole()?.tipo === 'admin'; }
  get pendienteAceptar() { return this.conSesion && !this.auth.currentRole()?.privacidadAceptada; }
  private h() { return { headers: new HttpHeaders({ Authorization: `Bearer ${this.auth.token()}` }) }; }

  async ngOnInit() {
    try { this.politica.set(await firstValueFrom(this.http.get(`${API}/privacidad/politica`))); } catch (e) { this.error.set(mensajeError(e)); }
    if (this.conSesion) await this.cargarSolicitudes();
  }

  async cargarSolicitudes() {
    try { this.solicitudes.set((await firstValueFrom(this.api.getSolicitudesDatos(this.esAdmin))).items); } catch (e) { this.error.set(mensajeError(e)); }
  }

  private async accion(fn: () => Promise<void>, ok = '') {
    this.ocupado.set(true); this.error.set(''); this.aviso.set('');
    try { await fn(); if (ok) this.aviso.set(ok); } catch (e) { this.error.set(mensajeError(e)); } finally { this.ocupado.set(false); }
  }

  aceptar() { return this.accion(() => this.auth.aceptarPrivacidad(this.politica().version), 'Gracias, registramos que leíste el aviso.'); }

  crear() {
    return this.accion(async () => {
      await firstValueFrom(this.api.crearSolicitudDatos(this.tipo, this.detalle));
      this.detalle = '';
      await this.cargarSolicitudes();
    }, 'Recibimos tu solicitud. Te responderemos por escrito dentro del plazo legal.');
  }

  descargarMisDatos() {
    return this.accion(async () => {
      const blob = await firstValueFrom(this.http.get(`${API}/privacidad/mis-datos`, { ...this.h(), responseType: 'blob' }));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'mis-datos.json'; a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  abierta = (s: SolicitudDatos) => ['recibida', 'en_proceso'].includes(s.status);
  tomar(s: SolicitudDatos) { return this.accion(async () => { await firstValueFrom(this.api.resolverSolicitudDatos(s.id, { status: 'en_proceso' })); await this.cargarSolicitudes(); }); }
  prorrogar(s: SolicitudDatos) {
    if (!confirm('El plazo se puede prorrogar una sola vez, por hasta 30 días corridos. ¿Prorrogar?')) return;
    return this.accion(async () => { await firstValueFrom(this.api.resolverSolicitudDatos(s.id, { extend: true })); await this.cargarSolicitudes(); });
  }
  cerrar(s: SolicitudDatos, status: 'resuelta' | 'rechazada') {
    const resolution = prompt(status === 'rechazada' ? 'Fundamenta el rechazo (se le informa al titular):' : 'Describe lo que se hizo (se le informa al titular):');
    if (!resolution) return;
    const apply = status === 'resuelta' && s.type === 'supresion' && confirm('¿Anonimizar ahora la cuenta? Se eliminan nombre, correo y RUN; se conservan trámites cerrados, pagos y la evidencia de firma.');
    return this.accion(async () => { await firstValueFrom(this.api.resolverSolicitudDatos(s.id, { status, resolution, apply })); await this.cargarSolicitudes(); }, 'Solicitud actualizada.');
  }
}
import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { mensajeError } from '../flujo';
import { environment } from '../../environments/environment';
const API = environment.apiUrl;

interface InfoFirma {
  folio: string; servicio: string; documentVersion: number; documentSha256: string;
  signer: { name: string; run: string; capacity: string; status: 'pendiente' | 'firmado' | 'rechazado' };
  request: { status: string; level: string; expiresAt: string };
  declaration: { version: string; text: string }; content: string | null;
}

@Component({ selector: 'app-firmar', imports: [FormsModule], templateUrl: './firmar.html', styleUrl: './firmar.scss' })
export class Firmar implements OnInit {
  private token = '';
  info = signal<InfoFirma | null>(null);
  cargando = signal(true);
  ocupado = signal(false);
  error = signal('');
  aviso = signal('');
  codigoEnviado = signal(false);
  terminado = signal<'firmado' | 'rechazado' | null>(null);
  codigo = '';
  nombreEscrito = '';
  acepta = false;

  constructor(private route: ActivatedRoute, private http: HttpClient) {}

  async ngOnInit() {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    try { this.info.set(await firstValueFrom(this.http.get<InfoFirma>(`${API}/firma/${this.token}`))); }
    catch (e) { this.error.set(mensajeError(e)); }
    finally { this.cargando.set(false); }
  }

  get disponible() { const i = this.info(); return !!i && i.request.status === 'pendiente' && i.signer.status === 'pendiente'; }

  private async accion(fn: () => Promise<void>) {
    this.ocupado.set(true); this.error.set(''); this.aviso.set('');
    try { await fn(); } catch (e) { this.error.set(mensajeError(e)); } finally { this.ocupado.set(false); }
  }

  pedirCodigo() {
    return this.accion(async () => {
      const r = await firstValueFrom(this.http.post<{ message: string; email: string }>(`${API}/firma/${this.token}/codigo`, {}));
      this.codigoEnviado.set(true);
      this.aviso.set(`${r.message} (${r.email})`);
    });
  }

  firmar() {
    return this.accion(async () => {
      await firstValueFrom(this.http.post(`${API}/firma/${this.token}/firmar`, { code: this.codigo, typedName: this.nombreEscrito, accept: this.acepta }));
      this.terminado.set('firmado');
    });
  }

  rechazar() {
    const motivo = prompt('¿Por qué no firmas? (opcional)');
    if (motivo === null) return;
    return this.accion(async () => {
      await firstValueFrom(this.http.post(`${API}/firma/${this.token}/rechazar`, { reason: motivo }));
      this.terminado.set('rechazado');
    });
  }

  descargar() {
    return this.accion(async () => {
      const blob = await firstValueFrom(this.http.get(`${API}/firma/${this.token}/documento`, { responseType: 'blob' }));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${this.info()?.folio}-firmado.pdf`; a.click();
      URL.revokeObjectURL(a.href);
    });
  }
}
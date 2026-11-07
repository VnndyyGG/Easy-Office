import { Component, input, output, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
const API = environment.apiUrl;

// ---- Modelo (tal como lo devuelve GET /api/privacidad/politica) ----
interface Dato { valor: string; pendiente?: boolean; }
export interface Politica {
  version: string;
  vigenteDesde: string;
  revisionLegalPendiente: boolean;
  responsable: { nombre: Dato; rut: Dato; domicilio: Dato; contacto: Dato; delegado: Dato };
  datos: { categoria: string; detalle: string }[];
  finalidades: { finalidad: string; base: string }[];
  destinatarios: { quien: string; para: string; fuera_de_chile: boolean | null }[];
  conservacion: string;
  derechos: { derecho: string; detalle: string }[];
  plazos: string;
  canal: string;
  reclamo: string;
  seguridad: string[];
}

// Íconos de Tabler por categoría; si llega una nueva desde el backend usa el genérico.
const ICONO_DATO: Record<string, string> = {
  'Identificación y contacto': 'ti-id',
  'Contenido de los trámites': 'ti-file-text',
  'Pagos': 'ti-credit-card',
  'Firma electrónica': 'ti-signature',
  'Uso del sistema': 'ti-activity',
};
const ICONO_DERECHO: Record<string, string> = {
  'Acceso': 'ti-eye', 'Rectificación': 'ti-pencil', 'Supresión': 'ti-trash',
  'Oposición': 'ti-hand-stop', 'Portabilidad': 'ti-arrows-exchange', 'Bloqueo': 'ti-lock-pause',
};
const ICONO_SEGURIDAD = ['ti-key', 'ti-user-shield', 'ti-clock-shield', 'ti-list-check'];

/**
 * Aviso de privacidad. Se usa como página (/privacidad) o como modal en el registro
 * (con [modal]="true"): ahí emite (cerrar) y (aceptar).
 */
@Component({
  selector: 'app-privacidad',
  styleUrl: './privacidad.scss',
  templateUrl: './privacidad.html',
})
export class Privacidad {
  modal = input(false);
  cerrar = output<void>();
  aceptar = output<void>();

  politica = signal<Politica | null>(null);
  error = signal('');

  readonly secciones = [
    ['responsable', 'Responsable'], ['datos', 'Datos'], ['finalidades', 'Finalidades'],
    ['destinatarios', 'Destinatarios'], ['conservacion', 'Conservación'], ['derechos', 'Derechos'], ['seguridad', 'Seguridad'],
  ];

  constructor(private http: HttpClient) {
    firstValueFrom(this.http.get<Politica>(`${API}/privacidad/politica`))
      .then(p => this.politica.set(p))
      .catch(() => this.error.set('No se pudo cargar el aviso de privacidad. Intenta de nuevo en unos minutos.'));
  }

  iconoDato(categoria: string) { return ICONO_DATO[categoria] ?? 'ti-database'; }
  iconoDerecho(derecho: string) { return ICONO_DERECHO[derecho] ?? 'ti-scale'; }
  iconoSeguridad(i: number) { return ICONO_SEGURIDAD[i] ?? 'ti-shield-check'; }

  /** Etiqueta de dónde está el destinatario: true = fuera de Chile, false = Chile, null = depende del proveedor. */
  ubicacion(d: Politica['destinatarios'][number]) {
    if (d.fuera_de_chile === true) return { texto: 'Fuera de Chile', aviso: true };
    if (d.fuera_de_chile === null) return { texto: 'Por definir', aviso: true };
    return { texto: d.quien.startsWith('Ejecutivos') ? 'Interno' : 'Chile', aviso: false };
  }

  fecha(iso: string) {
    const [a, m, d] = iso.slice(0, 10).split('-');
    return `${d}-${m}-${a}`;
  }

  ir(id: string) {
    document.getElementById('pp-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

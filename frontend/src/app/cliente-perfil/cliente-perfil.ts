import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DireccionSugerida, Perfil, Tramites } from '../tramites';
import { mensajeError } from '../flujo';
import { Auth } from '../auth';
import { REGIONES, comunaOficial, regionDeComuna } from '../chile';

const VACIO: Perfil = {
  nombre: '', run: '', email: '', telefono: '', domicilio: '', comuna: '', region: '',
  razonSocial: '', rutEmpresa: '', giro: '', domicilioEmpresa: '',
};

/** Mismo formato que en el registro: 76.123.456-7 (acepta "761234567" o "76123456-7"). */
const formatoRut = (valor: string) => {
  const limpio = valor.replace(/[^0-9kK]/g, '').toUpperCase().slice(0, 9);
  return limpio.length <= 1 ? limpio : limpio.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + limpio.slice(-1);
};

type CampoDireccion = 'domicilio' | 'domicilioEmpresa';

/** "Mi perfil": datos del cliente que, si él lo elige, rellenan automáticamente sus trámites. */
@Component({
  imports: [FormsModule, RouterLink],
  selector: 'app-cliente-perfil',
  styleUrl: './cliente-perfil.scss',
  templateUrl: './cliente-perfil.html',
})
export class ClientePerfil implements OnInit {
  datos = signal<Perfil>({ ...VACIO });
  cargando = signal(true);
  guardando = signal(false);
  error = signal('');
  aviso = signal('');
  cambios = signal(false);

  readonly regiones = REGIONES;
  comunas = computed(() => REGIONES.find(r => r.nombre === this.datos().region)?.comunas ?? []);
  /** Cuántos datos de autocompletado tiene llenos (para la barra de avance). */
  completos = computed(() => {
    const d = this.datos();
    return [d.telefono, d.domicilio, d.comuna, d.region].filter(x => x.trim()).length;
  });

  /** El backend guarda "12345678-5"; se muestra "12.345.678-5". */
  run = computed(() => formatoRut(this.datos().run));

  constructor(private api: Tramites, private auth: Auth) {}

  async ngOnInit() {
    try {
      const p = await firstValueFrom(this.api.getPerfil());
      this.datos.set({ ...p, rutEmpresa: formatoRut(p.rutEmpresa) });
    } catch (e) {
      this.error.set(mensajeError(e));
    } finally {
      this.cargando.set(false);
    }
  }

  set<K extends keyof Perfil>(k: K, v: Perfil[K]) {
    this.datos.update(d => ({ ...d, [k]: v }));
    this.cambios.set(true);
    this.aviso.set('');
  }
  /** Al cambiar la región se borra la comuna si ya no corresponde. */
  setRegion(region: string) {
    const comuna = this.datos().comuna;
    this.set('region', region);
    if (comuna && regionDeComuna(comuna) !== region) this.set('comuna', '');
  }

  setRutEmpresa(valor: string) { this.set('rutEmpresa', formatoRut(valor)); }

  // ---- Domicilio: las mismas sugerencias de direcciones reales que en el formulario del trámite ----
  sugerencias = signal<{ campo: CampoDireccion; items: DireccionSugerida[] } | null>(null);
  private esperaDireccion?: ReturnType<typeof setTimeout>;
  /** Espera a que el cliente deje de escribir (350 ms) para no consultar en cada tecla. */
  escribirDireccion(campo: CampoDireccion, v: string) {
    this.set(campo, v);
    clearTimeout(this.esperaDireccion);
    if (v.trim().length < 4) { this.sugerencias.set(null); return; }
    this.esperaDireccion = setTimeout(async () => {
      try {
        const { items } = await firstValueFrom(this.api.buscarDirecciones(v.trim()));
        if (this.datos()[campo] === v) this.sugerencias.set({ campo, items });   // descarta respuestas de algo ya borrado
      } catch {
        this.sugerencias.set(null);   // si el buscador falla, se sigue escribiendo a mano
      }
    }, 350);
  }
  /** El buscador trae barrio, ciudad y provincia mezclados: la comuna es el primero que está en la lista oficial. */
  comunaDe(s: DireccionSugerida) {
    for (const lugar of s.lugares) {
      const c = comunaOficial(lugar);
      if (c) return c;
    }
    return undefined;
  }
  /** Al elegir una sugerencia del domicilio personal también se completan la comuna y la región. */
  elegirDireccion(campo: CampoDireccion, s: DireccionSugerida) {
    this.sugerencias.set(null);
    const comuna = this.comunaDe(s);
    this.set(campo, campo === 'domicilioEmpresa' && comuna ? `${s.direccion}, ${comuna}` : s.direccion);
    const region = comuna && regionDeComuna(comuna);
    if (campo === 'domicilio' && comuna && region) { this.set('region', region); this.set('comuna', comuna); }
  }

  async guardar() {
    const d = this.datos();
    if (!d.nombre.trim()) { this.error.set('El nombre no puede quedar vacío.'); return; }
    this.guardando.set(true);
    this.error.set('');
    try {
      const { run, email, ...editables } = d;
      const res = await firstValueFrom(this.api.guardarPerfil(editables));
      const { perfil, ...nuevos } = res;
      this.datos.set({ ...nuevos, rutEmpresa: formatoRut(nuevos.rutEmpresa) });
      this.auth.actualizarPerfil(perfil);
      this.cambios.set(false);
      this.aviso.set('Perfil guardado. Desde ahora puedes usar estos datos al llenar un trámite.');
    } catch (e) {
      this.error.set(mensajeError(e));
    } finally {
      this.guardando.set(false);
    }
  }
}

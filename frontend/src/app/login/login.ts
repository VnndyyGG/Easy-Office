import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Auth } from '../auth';

@Component({
  imports: [FormsModule],
  selector: 'app-login',
  styleUrl: './login.scss',
  templateUrl: './login.html',
})
export class Login {
  run = '';
  nombre = '';
  email = '';
  password = '';
  errorLogin = signal('');
  errorRegistro = signal('');
  mostrarClave = signal(false);
  cargando = signal(false);
  runValido = signal(true);

  isToggled = signal(false);
  avisoClaveUnica = signal(false);

  aceptaPrivacidad = false;

  constructor(private auth: Auth, private router: Router) { }


  onRunChange(valor: string) {
    this.run = this.formatearRun(valor);
    const limpio = this.run.replace(/[.\-]/g, '');
    // No muestra error hasta que el run esté casi completo
    this.runValido.set(limpio.length < 8 || this.validarRun(this.run));
  }

  formatearRun(valor: string): string {
    const limpio = valor.replace(/[^0-9kK]/g, '').toUpperCase().slice(0, 9);
    if (limpio.length <= 1) return limpio;
    const cuerpo = limpio.slice(0, -1);
    const dv = limpio.slice(-1);
    return cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
  }

  validarRun(run: string): boolean {
    const limpio = run.replace(/[.\-\s]/g, '').toUpperCase();
    if (!/^\d{7,8}[0-9K]$/.test(limpio)) return false;
    const cuerpo = limpio.slice(0, -1);
    const dv = limpio.slice(-1);
    let suma = 0, factor = 2;
    for (const d of [...cuerpo].reverse()) {
      suma += Number(d) * factor;
      factor = factor === 7 ? 2 : factor + 1;
    }
    const r = 11 - (suma % 11);
    const esperado = r === 11 ? '0' : r === 10 ? 'K' : String(r);
    return dv === esperado;
  }


  registrarConClaveUnica() {
    this.avisoClaveUnica.set(true);
  }

  setMode(registro: boolean) {
    this.isToggled.set(registro);
    this.mostrarClave.set(false);
    this.errorLogin.set('');
    this.errorRegistro.set('');
    this.avisoClaveUnica.set(false);
  }

  async onSubmit() {
    if (!this.email.trim() || !this.password) {
      this.errorLogin.set('Ingresa tu correo o RUN y tu contraseña.');
      return;
    }
    this.cargando.set(true);
    const ok = await this.auth.attemptLogin(this.email.trim(), this.password);
    this.cargando.set(false);
    if (!ok) {
      this.errorLogin.set('Correo/RUN o contraseña incorrectos.');
      return;
    }
    this.errorLogin.set('');
    const tipo = this.auth.currentRole()?.tipo;
    this.router.navigate(['/' + tipo]);
  }

  async onRegister() {
    if (!this.nombre.trim() || !this.email.trim() || !this.run.trim() || !this.password) {
      this.errorRegistro.set('Completa todos los campos.');
      return;
    }
    if (!this.aceptaPrivacidad) {
      this.errorRegistro.set('Debes leer y aceptar el aviso de privacidad para crear tu cuenta.');
      return;
    }
    if (this.password.length < 10) {
      this.errorRegistro.set('La contraseña debe tener al menos 10 caracteres.');
      return;
    }
    if (!this.validarRun(this.run)) {
      this.errorRegistro.set('El RUN ingresado no es válido.');
      return;
    }
    this.cargando.set(true);
    const res = await this.auth.register(
      this.nombre.trim(),
      this.email.trim(),
      this.run.trim(),
      this.password,
      this.aceptaPrivacidad
    );
    this.cargando.set(false);
    if (!res.ok) {
      this.errorRegistro.set(res.message ?? 'No se pudo crear la cuenta.');
      return;
    }
    this.errorRegistro.set('');
    const tipo = this.auth.currentRole()?.tipo;
    this.router.navigate(['/' + tipo]);
  }
}
import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';
const API_URL = environment.apiUrl;
export interface Rol {
  id: number;
  name: string;
  email: string;
  run: string;
  role: string;
  initials: string;
  avatarBg: string;
  crumb: string;
  tipo: 'cliente' | 'admin' | 'comercial' | 'finanzas';
  active: boolean;
  privacidadAceptada: boolean;
}




/** Prefijo del avance de formularios guardado en localStorage (ver TramiteDetalle). */
export const PREFIJO_AVANCE = 'eo-avance-';

@Injectable({ providedIn: 'root' })
export class Auth {
  currentRole = signal<Rol | null>(null);
  token = signal<string | null>(null);

  constructor(private http: HttpClient) {
    try {
      const t = sessionStorage.getItem('token');
      const p = sessionStorage.getItem('perfil');
      if (t && p) {
        this.token.set(t);
        this.currentRole.set(JSON.parse(p));
      }
    } catch { /* sin storage disponible */ }
  }

  async attemptLogin(email: string, password: string): Promise<boolean> {
    try {
      const result: any = await firstValueFrom(
        this.http.post(`${API_URL}/auth/login`, { email, password })
      );
      this.guardarSesion(result.token, result.perfil);
      return true;
    } catch (e: any) {
      console.error('Login falló:', e.status, e.error);
      return false;
    }
  }

  async register(name: string, email: string, rut: string, password: string, acceptPrivacy: boolean): Promise<{ ok: boolean; message?: string }> {
    try {
      const result: any = await firstValueFrom(
        this.http.post(`${API_URL}/auth/register`, { name, email, rut, password, acceptPrivacy })
      );
      this.guardarSesion(result.token, result.perfil);
      return { ok: true };
    } catch (e: any) {
      console.error('Registro falló:', e.status, JSON.stringify(e.error));
      const msg = e.error?.error?.message || e.error?.message || 'No se pudo crear la cuenta.';
      return { ok: false, message: msg };
    }
  }

  /** Tras editar "Mi perfil": refresca el nombre e iniciales que muestra la cabecera. */
  actualizarPerfil(perfil: Rol) {
    const t = this.token();
    if (t) this.guardarSesion(t, perfil);
  }

  private guardarSesion(token: string, perfil: Rol) {
    this.token.set(token);
    this.currentRole.set(perfil);
    sessionStorage.setItem('token', token);
    sessionStorage.setItem('perfil', JSON.stringify(perfil));
  }

  logout() {
    const token = this.token();
    if (token) {
      this.http.post(`${API_URL}/auth/logout`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      }).subscribe({ error: () => { } });
    }
    this.token.set(null);
    this.currentRole.set(null);
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('perfil');
    // El avance de formularios contiene RUT y direcciones: no se deja en el navegador al cerrar sesión.
    try {
      Object.keys(localStorage).filter(k => k.startsWith(PREFIJO_AVANCE)).forEach(k => localStorage.removeItem(k));
    } catch { /* sin storage disponible */ }
  }
}
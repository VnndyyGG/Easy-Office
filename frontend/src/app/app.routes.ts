import { Routes } from '@angular/router';
import { Login } from './login/login';
import { Shell } from './shell/shell';
import { Carrito } from './carrito/carrito';
import { ClienteDashboard } from './cliente-dashboard/cliente-dashboard';
import { AdminDashboard } from './admin-dashboard/admin-dashboard';
import { ComercialDashboard } from './comercial-dashboard/comercial-dashboard';
import { FinanzasDashboard } from './finanzas-dashboard/finanzas-dashboard';
import { authGuard, roleGuard } from './auth.guard';
import { Firmar } from './firmar/firmar';
import { Privacidad } from './privacidad/privacidad';

export const routes: Routes = [
  { path: '', component: Login },
  { path: 'firmar/:token', component: Firmar },
  { path: 'privacidad', component: Privacidad },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: 'cliente', component: ClienteDashboard, canActivate: [roleGuard('cliente')] },
      { path: 'cliente/carrito', component: Carrito, canActivate: [roleGuard('cliente')] },
      { path: 'admin', component: AdminDashboard, canActivate: [roleGuard('admin')] },
      { path: 'comercial', component: ComercialDashboard, canActivate: [roleGuard('comercial')] },
      { path: 'finanzas', component: FinanzasDashboard, canActivate: [roleGuard('finanzas')] },
    ]
  }
];
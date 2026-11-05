import { Component } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { Auth } from '../auth';
import { firstValueFrom } from 'rxjs';
import { Tramites } from '../tramites';


@Component({
  imports: [RouterOutlet, RouterLink],
  selector: 'app-shell',
  styleUrl: './shell.scss',
  templateUrl: './shell.html',
})
export class Shell {
  constructor(public auth: Auth, private router: Router, private api: Tramites) { }

  async aceptarAviso() {
    const caps = await firstValueFrom(this.api.getCapabilities());
    await this.auth.aceptarPrivacidad(caps.privacidad.version);
  }
  logout() {
    this.auth.logout();
    this.router.navigate(['/']);
  }
}
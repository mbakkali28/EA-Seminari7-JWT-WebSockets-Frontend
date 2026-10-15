import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map, tap, throwError } from 'rxjs';

import { environment } from '../../environments/environment';
import {
  LoginRequest,
  LoginResponse,
  RefreshResponse,
  RegisterRequest,
  RegisterResponse,
  User,
} from '../models';

// Nombres con los que guardo la sesión en localStorage
const USER_KEY = 'user';

// Por qué localStorage y no una cookie HttpOnly (está explicado con más detalle en el README):
// la API devuelve los tokens en el JSON del login, así que el frontend tiene que guardarlos él.
// localStorage sobrevive a recargar la página y es fácil de entender. Su riesgo es que cualquier
// script que se ejecute en la página puede leerlo (un ataque XSS). Una cookie HttpOnly no se puede
// leer desde JavaScript, pero obliga a cambiar el backend y a protegerse de otro ataque (CSRF).

// Al arrancar la app, recupero el usuario que dejó guardado el último login
function readStoredUser(): User | null {
  const stored = localStorage.getItem(USER_KEY);
  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored) as User;
  } catch {
    // Si alguien ha tocado el valor a mano y no es JSON, es como no tener sesión
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private baseUrl = `${environment.apiUrl}/auth`;

  // El usuario con sesión, o null si no hay sesión. Es privado y modificable aquí dentro;
  // fuera solo se puede leer (asReadonly), así nadie cambia la sesión sin pasar por este servicio
  private currentUser = signal<User | null>(readStoredUser());
  readonly user = this.currentUser.asReadonly();

  private currentUserToken = signal<string | null>(null);

  // computed: se recalculan solos cada vez que cambia el usuario
  readonly isLoggedIn = computed(() => this.currentUser() !== null);
  readonly isAdmin = computed(() => this.currentUser()?.role === 'admin');

  /** POST /auth/register. No inicia sesión: la API no devuelve token y hay que hacer login */
  register(data: RegisterRequest): Observable<RegisterResponse> {
    return this.http.post<RegisterResponse>(`${this.baseUrl}/register`, data);
  }

  /** POST /auth/login. Si va bien, guarda los dos tokens y el usuario */
  login(credentials: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.baseUrl}/login`, credentials, { withCredentials: true }).pipe(
      // tap: hago algo con la respuesta sin cambiarla; el componente la sigue recibiendo igual
      tap((response) => {
        localStorage.setItem(USER_KEY, JSON.stringify(response.user));
        this.currentUser.set(response.user);
        this.currentUserToken.set(response.token);
      }),
    );
  }

  /** POST /auth/refresh. Pide un access token nuevo con el refresh token y lo guarda */
  refresh(): Observable<string> {

    return this.http.post<RefreshResponse>(`${this.baseUrl}/refresh`, {}, { withCredentials: true }).pipe(
      tap((response) => {
        this.currentUserToken.set(response.token);
      }),
      // map: de la respuesta { token } me quedo solo con el texto del token
      map((response) => response.token),
    );
  }

  /** Cierra la sesión: borra lo guardado y lleva al login */
  logout(): void {
    const clear = () => {
      localStorage.removeItem(USER_KEY);
      this.currentUser.set(null);
      this.currentUserToken.set(null);
      this.router.navigate(['/login']);
    };

    this.http.post(`${this.baseUrl}/logout`, {}, { withCredentials: true }).subscribe({ next: clear, error: clear });
  }

  /** El access token guardado, o null si no hay sesión. Lo usa el interceptor */
  getToken(): string | null {
    return this.currentUserToken();
  }
}

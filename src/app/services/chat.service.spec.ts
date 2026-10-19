import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { environment } from '../../environments/environment';
import { ChatService } from './chat.service';

// La conexión real del socket se prueba con el backend arrancado (ver la bitácora en LOGS.md).
// Aquí se prueba lo que no necesita un servidor de sockets.
describe('ChatService', () => {
  let service: ChatService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(ChatService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('getUsers() returns the users of GET /users', () => {
    let names: string[] = [];
    service.getUsers().subscribe((users) => (names = users.map((user) => user.name)));

    httpMock.expectOne(`${environment.apiUrl}/users`).flush({
      users: [
        { _id: 'u1', name: 'Admin' },
        { _id: 'u2', name: 'Usuario' },
      ],
    });

    expect(names).toEqual(['Admin', 'Usuario']);
  });

  it('starts with nobody online', () => {
    let ids: string[] | undefined;
    service.onlineUsers$.subscribe((v) => (ids = v));
    expect(ids).toEqual([]);
  });

  it('connect() refuses to connect without a session token', () => {
    expect(() => service.connect()).toThrowError(
      'No hay un token de sesión para conectar al chat.',
    );
  });

  it('watchChanges() does not fail without a session token', () => {
    expect(() => service.watchChanges('author').subscribe()).not.toThrow();
  });

  it('emitting before connecting fails with a clear message', () => {
    expect(() => service.sendMessage('general', 'hola')).toThrowError(/no está conectado/);
  });
});

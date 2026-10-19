import { HttpClient } from '@angular/common/http';
import { Injectable, effect, inject } from '@angular/core';
import { BehaviorSubject, Observable, Subject, filter, map } from 'rxjs';
import { io, type Socket } from 'socket.io-client';

import { environment } from '../../environments/environment';

import { AuthService } from './auth.service';

export interface ChatUser {
  _id: string;
  name: string;
}

export interface ChatMessage {
  _id: string;
  room: string;
  user: ChatUser;
  text: string;
  timestamp: string;
}

export interface ChatError {
  message: string;
}

// Aviso del servidor de un cambio
export interface DataChange {
  entity: 'author' | 'book';
  action: 'created' | 'updated' | 'deleted';
}

// Mensaje con el que el backend rechaza la conexión si el token falta, es falso o ha caducado
const AUTH_ERROR = 'Authentication error';

interface ChatUsersResponse {
  users: ChatUser[];
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);

  // Guardamos una sola conexión para que los componentes compartan el mismo socket.
  private socket: Socket | null = null;

  // Si el servidor rechaza el token, lo renovamos y reintentamos una sola vez (como el interceptor)
  private retriedWithNewToken = false;

  // Indica si el socket está conectado. El componente podrá observar este estado.
  private readonly connectionState = new BehaviorSubject<boolean>(false);
  readonly connectionStatus$ = this.connectionState.asObservable();

  // Permite que la interfaz pueda mostrar errores de conexión.
  private readonly connectionErrorSubject = new Subject<Error>();
  readonly connectionError$ = this.connectionErrorSubject.asObservable();

  // El servidor envía el historial solo al cliente que acaba de entrar en una sala.
  private readonly historySubject = new Subject<ChatMessage[]>();
  readonly history$ = this.historySubject.asObservable();

  // Los mensajes nuevos se emiten a todos los clientes conectados a la sala.
  private readonly messageSubject = new Subject<ChatMessage>();
  readonly messages$ = this.messageSubject.asObservable();

  // Ids de los usuarios que tienen el chat abierto. El servidor envía la lista entera cada vez
  // que alguien entra o sale. Es un BehaviorSubject para que quien se suscriba tarde tenga el valor.
  private readonly onlineUsersSubject = new BehaviorSubject<string[]>([]);
  readonly onlineUsers$ = this.onlineUsersSubject.asObservable();

  // Errores funcionales enviados por el backend (por ejemplo, sala no válida).
  private readonly chatErrorSubject = new Subject<ChatError>();
  readonly chatError$ = this.chatErrorSubject.asObservable();

  private readonly dataChangedSubject = new Subject<DataChange>();

  constructor() {
    // Al cerrar la sesión cierro el socket.
    effect(() => {
      if (!this.authService.isLoggedIn()) {
        this.disconnect();
      }
    });
  }

  // Avisos de cambios
  watchChanges(entity: DataChange['entity']): Observable<DataChange> {
    try {
      this.connect();
    } catch {
      // Sin sesión no se puede conectar.
    }
    return this.dataChangedSubject.pipe(filter((change) => change.entity === entity));
  }

  getUsers(): Observable<ChatUser[]> {
    // El interceptor HTTP añade el access token a esta petición protegida.
    return this.http
      .get<ChatUsersResponse>(`${environment.apiUrl}/users`)
      .pipe(map((response) => response.users));
  }

  connect(): void {
    // Evita crear otra conexión si ya hay un socket.
    if (this.socket) {
      return;
    }

    if (!this.authService.getToken()) {
      throw new Error('No hay un token de sesión para conectar al chat.');
    }

    // Desactivamos la conexión automática para registrar primero los eventos.
    this.socket = io(environment.socketUrl, {
      autoConnect: false,

      // Socket.IO enviará este objeto durante el handshake con el servidor.
      // Es una función y no un objeto fijo para que cada intento de conexión (también las
      // reconexiones automáticas) lea el token más reciente, por si se ha renovado.
      auth: (send) => send({ token: this.authService.getToken() }),
    });

    this.socket.on('connect', () => {
      this.retriedWithNewToken = false;
      this.connectionState.next(true);
    });

    this.socket.on('disconnect', () => {
      this.connectionState.next(false);
      // Sin conexión no sabemos quién está conectado: mejor no enseñar una lista antigua
      this.onlineUsersSubject.next([]);
    });

    this.socket.on('connect_error', (error) => {
      // El socket no pasa por el interceptor HTTP, así que si el access token ha caducado lo
      // renovamos aquí: pedimos uno nuevo con el refresh token y volvemos a conectar.
      // Si tampoco se puede renovar, la sesión ha terminado: logout lleva al login.
      if (error.message === AUTH_ERROR && !this.retriedWithNewToken) {
        this.retriedWithNewToken = true;
        this.authService.refresh().subscribe({
          next: () => this.socket?.connect(),
          error: () => this.authService.logout(),
        });
        return;
      }

      this.connectionErrorSubject.next(error);
    });

    this.socket.on('chat:history', (messages: ChatMessage[]) => {
      this.historySubject.next(messages);
    });

    this.socket.on('chat:message', (message: ChatMessage) => {
      this.messageSubject.next(message);
    });

    this.socket.on('users:online', (userIds: string[]) => {
      this.onlineUsersSubject.next(userIds);
    });

    this.socket.on('chat:error', (error: ChatError) => {
      this.chatErrorSubject.next(error);
    });

    this.socket.on('data:changed', (change: DataChange) => {
      this.dataChangedSubject.next(change);
    });

    // Inicia la conexión después de configurar sus eventos.
    this.socket.connect();
  }

  joinRoom(room: string): void {
    // El contrato exige entrar en la sala antes de solicitar historial o enviar mensajes.
    this.emit('chat:join', { room });
  }

  sendMessage(room: string, text: string): void {
    // El servidor obtiene el autor del JWT; el cliente solo envía sala y texto.
    this.emit('chat:message', { room, text });
  }

  emit<T>(eventName: string, payload: T): void {
    if (!this.socket?.connected) {
      throw new Error('No se puede enviar el mensaje: el chat no está conectado.');
    }

    // El nombre y los datos del evento deberán coincidir con el contrato del backend.
    this.socket.emit(eventName, payload);
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connectionState.next(false);
    this.onlineUsersSubject.next([]);
  }
}

import { io, Socket } from 'socket.io-client';
import { gameState } from '../state/StateManager';

/**
 * Race Wars — Network Manager
 * Handles all Socket.IO communication with the authoritative backend
 */

export interface PlayerState {
  x: number;
  z: number;
  h: number; // heading
  speed: number;
  isCrashed: boolean;
}

export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
  isReady: boolean;
  distance: number;
}

export class NetworkManager {
  private socket: Socket;
  private currentRoom: string | null = null;
  private myId: string = '';

  // Callbacks for Game/UI
  public onRoomJoined?: (roomCode: string, players: PlayerInfo[]) => void;
  public onPlayerJoined?: (id: string, info: PlayerInfo) => void;
  public onPlayerLeft?: (id: string) => void;
  public onPlayerUpdate?: (id: string, state: PlayerState) => void;
  public onPlayerReady?: (id: string, isReady: boolean) => void;
  
  public onCountdown?: (time: number) => void;
  public onRaceStart?: () => void;
  public onRaceFinished?: (rankings: any[]) => void;
  
  public onError?: (msg: string) => void;
  public onRoomLeft?: () => void;

  constructor() {
    // Determine backend URL (works for local dev and prod)
    const backendUrl = import.meta.env.VITE_SERVER_URL || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
      ? 'http://localhost:3000' 
      : window.location.origin);

    this.socket = io(backendUrl, {
      autoConnect: false, // We connect when needed
      reconnection: true,
      reconnectionAttempts: 5,
    });

    this.setupListeners();
  }

  public connect(playerName: string, color: string): void {
    this.socket.auth = { playerName, color };
    this.socket.connect();
  }

  public disconnect(): void {
    this.socket.disconnect();
    this.currentRoom = null;
  }

  private setupListeners(): void {
    this.socket.on('connect', () => {
      this.myId = this.socket.id || '';
    });

    this.socket.on('disconnect', () => {
      const wasInRoom = this.currentRoom !== null;
      this.currentRoom = null;
      this.onRoomLeft?.();
      if (wasInRoom) gameState.setState('DISCONNECTED');
    });
    this.socket.on('connect_error', () => this.onError?.('Cannot connect to the multiplayer server. Start the backend and try again.'));

    // Room events
    this.socket.on('room_joined', (data: { roomCode: string, players: PlayerInfo[] }) => {
      this.currentRoom = data.roomCode;
      if (this.onRoomJoined) this.onRoomJoined(data.roomCode, data.players);
    });

    this.socket.on('player_joined', (info: PlayerInfo) => {
      if (this.onPlayerJoined) this.onPlayerJoined(info.id, info);
    });

    this.socket.on('player_left', (id: string) => {
      if (this.onPlayerLeft) this.onPlayerLeft(id);
    });

    this.socket.on('player_ready', (data: { id: string, isReady: boolean }) => {
      if (this.onPlayerReady) this.onPlayerReady(data.id, data.isReady);
    });

    this.socket.on('player_update', (data: { id: string, state: PlayerState }) => {
      if (this.onPlayerUpdate) this.onPlayerUpdate(data.id, data.state);
    });

    // Race events
    this.socket.on('countdown', (time: number) => {
      if (this.onCountdown) this.onCountdown(time);
    });

    this.socket.on('start_race', () => {
      if (this.onRaceStart) this.onRaceStart();
    });

    this.socket.on('race_finished', (rankings: any[]) => {
      if (this.onRaceFinished) this.onRaceFinished(rankings);
    });

    // Error
    this.socket.on('error_msg', (msg: string) => {
      if (this.onError) this.onError(msg);
      else {
        gameState.setState('ERROR');
        // Let UI pick up the error state, we could store the error message in a global store if needed
        console.error("Server error:", msg);
      }
    });
  }

  // --- Emit Actions ---

  public createRoom(): void {
    this.socket.emit('create_room');
  }

  public joinRoom(roomCode: string): void {
    this.socket.emit('join_room', roomCode.toUpperCase());
  }

  public leaveRoom(): void {
    this.socket.emit('leave_room');
    this.currentRoom = null;
    this.onRoomLeft?.();
  }

  public setReady(isReady: boolean): void {
    this.socket.emit('set_ready', isReady);
  }

  public sendUpdate(state: PlayerState): void {
    if (!this.currentRoom) return;
    this.socket.volatile.emit('player_update', state); // volatile for high frequency, droppable packets
  }

  public finishRace(distance: number): void {
    this.socket.emit('finish_race', { distance });
  }

  // --- Getters ---

  public getId(): string {
    return this.myId;
  }

  public getRoomCode(): string | null {
    return this.currentRoom;
  }

  public isInRoom(): boolean {
    return this.currentRoom !== null;
  }
}

import { Server } from 'socket.io';
import { config } from './config.js';

let io: Server;
export const initSocket = (server: import('http').Server) => {
  io = new Server(server, { cors: { origin: config.origins, methods: ['GET', 'POST', 'PATCH'] } });
  io.on('connection', socket => { socket.on('branch:join', (branchId: string) => socket.join(`branch:${branchId}`)); socket.on('branch:leave', (branchId: string) => socket.leave(`branch:${branchId}`)); });
  return io;
};
export const emitQueueUpdate = (branchId: string, event: string, payload: unknown) => io?.to(`branch:${branchId}`).emit(event, payload);

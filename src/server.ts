import http from 'node:http';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { pool } from './db.js';
import { errorHandler } from './http.js';
import { router } from './routes.js';
import { initSocket } from './socket.js';

const app=express(); app.use(helmet()); app.use(cors({origin:config.origins})); app.use(express.json({limit:'100kb'})); app.use(rateLimit({windowMs:60_000,max:120,standardHeaders:'draft-8',legacyHeaders:false})); app.use((req,res,next)=>{const start=Date.now();res.on('finish',()=>console.info(`${req.method} ${req.path} ${res.statusCode} ${Date.now()-start}ms`));next();});app.use('/api',router);app.use(errorHandler);
const server=http.createServer(app); initSocket(server);
server.listen(config.port,()=>console.info(`QueueLess API listening on :${config.port}`));
const shutdown=async()=>{await pool.end();server.close(()=>process.exit(0));};process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);

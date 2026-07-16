import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { config } from './config/env.js';
import { openapiDocument } from './config/openapi.js';
import { pool } from './database/postgres.js';
import { errorHandler } from './middlewares/error.middleware.js';
import { router } from './routes/api.routes.js';
import { startNotificationWorker } from './services/notification.service.js';

const app=express(); app.use('/admin', express.static('public/admin',{setHeaders:res=>res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'") })); app.get('/openapi.json',(_req,res)=>res.json(openapiDocument)); app.use('/docs',swaggerUi.serve,swaggerUi.setup(openapiDocument,{customSiteTitle:'QueueLess API Docs'})); app.use(helmet()); app.use(cors({origin:config.origins})); app.use(express.json({limit:'100kb'})); app.use(rateLimit({windowMs:60_000,max:120,standardHeaders:'draft-8',legacyHeaders:false})); app.use((req,res,next)=>{const start=Date.now();res.on('finish',()=>console.info(`${req.method} ${req.path} ${res.statusCode} ${Date.now()-start}ms`));next();});app.use('/api',router);app.use(errorHandler);
const server=app.listen(config.port,()=>console.info(`QueueLess API listening on :${config.port}`));
startNotificationWorker();
const shutdown=async()=>{await pool.end();server.close(()=>process.exit(0));};process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);

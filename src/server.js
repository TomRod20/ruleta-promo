import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import crypto from 'crypto';
import { connectMongo } from './db.js';
import apiRouter from './routes/api.js';
import Config from './models/Config.js';
import Prize from './models/Prize.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======== Admin auth (código + cookie HttpOnly) ========
const isProd = process.env.NODE_ENV === 'production';
const ADMIN_CODE = process.env.ADMIN_CODE || '123456';
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'change-me';
const ADMIN_SESSION_TTL_HOURS = Number(process.env.ADMIN_SESSION_TTL_HOURS || 72);

function parseCookies(req){
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(p=>{
    const [k, ...v] = p.trim().split('=');
    if(!k) return;
    out[k] = decodeURIComponent(v.join('='));
  });
  return out;
}

function makeToken(){
  const iat = Date.now();
  const msg = `${ADMIN_CODE}:${iat}`;
  const sig = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(msg).digest('hex');
  return `${iat}.${sig}`;
}

function verifyToken(token){
  if(!token) return false;
  const [iatStr, sig] = token.split('.');
  const iat = Number(iatStr);
  if(!iat || !sig) return false;
  const ageMs = Date.now() - iat;
  if(ageMs > ADMIN_SESSION_TTL_HOURS * 3600000) return false;
  const msg = `${ADMIN_CODE}:${iat}`;
  const expected = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(msg).digest('hex');
  try{
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }catch{ return false; }
}

function setAuthCookie(res){
  const token = makeToken();
  const ttlSec = ADMIN_SESSION_TTL_HOURS * 3600;
  const parts = [
    `admin_token=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${ttlSec}`
  ];
  if(isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearAuthCookie(res){
  const parts = [
    'admin_token=',
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0'
  ];
  if(isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function isAuthed(req){
  const cookies = parseCookies(req);
  return verifyToken(cookies['admin_token']);
}

function requireAdminAPI(req,res,next){
  if(isAuthed(req)) return next();
  return res.status(401).json({ error: 'No autorizado' });
}

// Página de login minimal (se muestra cuando no hay cookie válida)
const adminLoginHTML = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Admin | Ingreso</title>
<style>
  body{margin:0;background:#0f172a;color:#e5e7eb;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
  .card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:24px;max-width:420px;width:100%;text-align:center}
  h1{margin:0 0 8px}
  .hint{color:#94a3b8}
  .row{display:flex;gap:10px;margin-top:12px}
  input{flex:1;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:#fff;outline:none}
  button{padding:12px 16px;border-radius:10px;border:0;background:#16a34a;color:#fff;font-weight:800;cursor:pointer}
  .msg{min-height:22px;color:#ffd28f;margin-top:8px}
</style>
</head><body>
<div class="wrap">
  <div class="card">
    <h1>🔐 Ingreso Admin</h1>
    <div class="hint">Ingresá tu código para acceder al panel.</div>
    <div class="row">
      <input id="code" type="password" placeholder="Código de admin" />
      <button id="go">Entrar</button>
    </div>
    <div id="msg" class="msg"></div>
  </div>
</div>
<script>
async function login(){
  const code = document.getElementById('code').value.trim();
  const r = await fetch('/api/admin/login', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ code })
  });
  if(r.ok){ location.href='/admin'; }
  else{
    const d = await r.json().catch(()=>({}));
    document.getElementById('msg').textContent = d.error || 'Código incorrecto';
  }
}
document.getElementById('go').addEventListener('click', login);
document.getElementById('code').addEventListener('keydown', e=>{ if(e.key==='Enter') login(); });
</script>
</body></html>`;

// Endpoints de login/logout
app.post('/api/admin/login', (req,res) => {
  const { code } = req.body || {};
  if((code||'') === ADMIN_CODE){
    setAuthCookie(res);
    return res.json({ ok:true });
  }
  return res.status(401).json({ error: 'Código incorrecto' });
});

app.post('/api/admin/logout', (req,res) => {
  clearAuthCookie(res);
  res.json({ ok:true });
});

// ======== Rutas protegidas /admin (antes que el static) ========
// Proteger TODO lo que cuelga de /admin: si no hay cookie válida, mostrar login
app.use('/admin', (req,res,next) => {
  if(isAuthed(req)) return next();
  if(req.method === 'GET') return res.send(adminLoginHTML);
  return res.status(401).json({ error: 'No autorizado' });
});
// Servir el admin solo si pasó el gate anterior
app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));

// ======== Protecciones de API (antes de montar el router) ========
// Config (GET/PUT) solo admin
app.use('/api/config', requireAdminAPI);

// Premios: GET público (para Home); POST/PUT/DELETE solo admin
app.use('/api/prizes', (req,res,next) => {
  if(req.method === 'GET') return next();
  return requireAdminAPI(req,res,next);
});

// ======== Router API ========
app.use('/api', apiRouter);

// Página dinámica de premio
app.get('/premio/:dni', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'premio.html'));
});

// Static general (DESPUÉS de las rutas /admin y /premio)
app.use(express.static(path.join(__dirname, '..', 'public')));

// ======== Bootstrap ========
const port = process.env.PORT || 3000;

async function bootstrap(){
  await connectMongo(process.env.MONGO_URI);

  // Semillas mínimas
  let cfg = await Config.findOne();
  if(!cfg){
    const ex = (process.env.EXEMPT_DNIS || '45035781')
      .split(',').map(s => s.trim()).filter(Boolean);
    cfg = await Config.create({
      businessName: process.env.NEGOCIO_NOMBRE || 'Tu Negocio',
      instagramQrUrl: process.env.INSTAGRAM_QR_URL || '',
      exemptDnis: ex
    });
    console.log('⚙️  Config creada con DNIs exentos:', cfg.exemptDnis);
  }

  const count = await Prize.countDocuments();
  if(count === 0){
    await Prize.insertMany([
      { name: '10% de descuento', image: '', weight: 30 },
      { name: '2x1 en remeras', image: '', weight: 10 },
      { name: 'Sticker gratis', image: '', weight: 25 },
      { name: 'Gorra de regalo', image: '', weight: 5 },
      { name: 'Sigue participando', image: '', weight: 30 }
    ]);
    console.log('🎁 Premios de ejemplo cargados');
  }

  app.listen(port, () => console.log(`🚀 Servidor en http://localhost:${port}`));
}

bootstrap().catch(err => {
  console.error('Error al iniciar:', err);
  process.exit(1);
});

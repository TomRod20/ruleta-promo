import { Router } from 'express';
import Prize from '../models/Prize.js';
import Spin from '../models/Spin.js';
import Config from '../models/Config.js';


function pickWeighted(prizes){
const arr = prizes.filter(p => (p.weight ?? 0) > 0);
const total = arr.reduce((a,b)=> a + b.weight, 0);
if(total <= 0) return arr[0] || prizes[0];
let r = Math.random() * total;
for(const p of arr){
if(r < p.weight) return p;
r -= p.weight;
}
return arr[arr.length-1] || prizes[0];
}


const router = Router();

// ------- CONFIG -------
router.get('/config', async (req,res) => {
const cfg = await Config.findOne();
res.json(cfg || {});
});


router.put('/config', async (req,res) => {
const { businessName, instagramQrUrl } = req.body;
let cfg = await Config.findOne();
if(!cfg) cfg = new Config();
if(typeof businessName === 'string') cfg.businessName = businessName.trim();
if(typeof instagramQrUrl === 'string') cfg.instagramQrUrl = instagramQrUrl.trim();
await cfg.save();
res.json({ ok:true, config: cfg });
});

// ------- PRIZES CRUD -------
router.get('/prizes', async (req,res) => {
const list = await Prize.find().sort({ createdAt: 1 });
res.json(list);
});


router.post('/prizes', async (req,res) => {
const { name, image = '', weight = 0 } = req.body;
if(!name || typeof weight !== 'number') return res.status(400).json({ error:'Datos inválidos' });
const p = await Prize.create({ name: name.trim(), image: image.trim(), weight });
res.status(201).json(p);
});


router.put('/prizes/:id', async (req,res) => {
const { id } = req.params;
const { name, image, weight } = req.body;
const upd = {};
if(typeof name === 'string') upd.name = name.trim();
if(typeof image === 'string') upd.image = image.trim();
if(typeof weight === 'number') upd.weight = weight;
const p = await Prize.findByIdAndUpdate(id, upd, { new:true });
if(!p) return res.status(404).json({ error:'No encontrado' });
res.json(p);
});


router.delete('/prizes/:id', async (req,res) => {
const { id } = req.params;
const r = await Prize.findByIdAndDelete(id);
if(!r) return res.status(404).json({ error:'No encontrado' });
res.json({ ok:true });
});
// ------- SPIN -------
router.post('/spin', async (req,res) => {
const { dni } = req.body;
if(!/^\d{8}$/.test(dni || '')) return res.status(400).json({ error: 'DNI debe tener 8 dígitos' });


const cfg = await Config.findOne() || new Config();
const cooldownHours = Number(process.env.COOLDOWN_HOURS || 24);
const exempt = new Set([...(cfg.exemptDnis || [])]);


// Si es exento, permitir siempre
const now = new Date();
let record = await Spin.findOne({ dni });


if(!exempt.has(dni)){
if(record?.nextAvailableAt && record.nextAvailableAt > now){
const ms = record.nextAvailableAt - now;
const h = Math.floor(ms/3600000);
const m = Math.ceil((ms%3600000)/60000);
return res.status(429).json({ error: `Este DNI ya giró. Faltan ${h}h ${m}m para volver a tirar.`, retryInMs: ms });
}
}


const prizes = await Prize.find();
if(prizes.length === 0) return res.status(400).json({ error: 'No hay premios configurados' });


const elegido = pickWeighted(prizes);


// setear cooldown (incluso si es exento, podemos no setearlo)
const next = exempt.has(dni) ? now : new Date(now.getTime() + cooldownHours*3600000);
const payload = {
lastSpinAt: now,
nextAvailableAt: next,
lastPrizeId: elegido._id,
lastPrizeName: elegido.name,
lastPrizeImage: elegido.image || ''
};

if(record){
await Spin.updateOne({ dni }, { $set: payload });
} else {
record = await Spin.create({ dni, ...payload });
}


res.json({ ok:true, prize: elegido, redirect: `/premio/${dni}` });
});


// Último premio por DNI (para la página de /premio/:dni)
router.get('/last-prize/:dni', async (req,res) => {
const { dni } = req.params;
if(!/^\d{8}$/.test(dni || '')) return res.status(400).json({ error: 'DNI inválido' });
const cfg = await Config.findOne();
const rec = await Spin.findOne({ dni });
if(!rec) return res.status(404).json({ error: 'Sin registro de premio para este DNI' });
res.json({
businessName: cfg?.businessName || 'Tu Negocio',
instagramQrUrl: cfg?.instagramQrUrl || '',
dni,
prizeName: rec.lastPrizeName,
prizeImage: rec.lastPrizeImage || ''
});
});


export default router;
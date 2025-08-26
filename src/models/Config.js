import mongoose from 'mongoose';


const ConfigSchema = new mongoose.Schema({
businessName: { type: String, default: 'Tu Negocio' },
instagramQrUrl: { type: String, default: '' },
exemptDnis: { type: [String], default: ['45035781'] } // DNIs sin cooldown
}, { timestamps: true });


export default mongoose.model('Config', ConfigSchema);
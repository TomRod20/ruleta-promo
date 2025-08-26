import mongoose from 'mongoose';


const SpinSchema = new mongoose.Schema({
dni: { type: String, required: true, unique: true, match: /^\d{8}$/ },
lastSpinAt: { type: Date },
nextAvailableAt: { type: Date },
lastPrizeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Prize' },
lastPrizeName: { type: String },
lastPrizeImage: { type: String }
}, { timestamps: true });



export default mongoose.model('Spin', SpinSchema);
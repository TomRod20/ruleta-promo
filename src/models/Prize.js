import mongoose from 'mongoose';


const PrizeSchema = new mongoose.Schema({
name: { type: String, required: true, trim: true },
image: { type: String, default: '' }, // URL opcional
weight: { type: Number, required: true, min: 0 } // % o peso relativo
}, { timestamps: true });


export default mongoose.model('Prize', PrizeSchema);
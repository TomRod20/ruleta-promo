import mongoose from 'mongoose';


export async function connectMongo(uri){
mongoose.set('strictQuery', true);
await mongoose.connect(uri);
console.log('✅ MongoDB conectado');
}
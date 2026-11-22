import mongoose from 'mongoose';

// Atomic sequence used for human-readable ticket numbers (CC-26-0147).
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });

export const Counter = mongoose.model('Counter', counterSchema);

export async function nextSequence(name, start = 100) {
  const doc = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return start + doc.seq;
}

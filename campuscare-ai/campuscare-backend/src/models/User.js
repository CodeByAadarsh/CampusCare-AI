import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['student', 'admin'], default: 'student' },
    enrollment: { type: String, trim: true },
    branch: { type: String, trim: true },
    title: { type: String, trim: true }, // for admins, e.g. "Campus Administration"
  },
  { timestamps: true }
);

/** Public shape sent to the frontend (never includes the password hash). */
userSchema.methods.toPublic = function toPublic() {
  const u = { id: String(this._id), name: this.name, email: this.email, role: this.role };
  if (this.enrollment) u.enrollment = this.enrollment;
  if (this.branch) u.branch = this.branch;
  if (this.title) u.title = this.title;
  return u;
};

export const User = mongoose.model('User', userSchema);

/**
 * Creates demo accounts and sample reports (same data as the frontend's demo mode).
 *   npm run seed         -> adds the demo accounts if missing; adds sample reports only if there are none
 *   npm run seed:reset   -> deletes ALL users, reports and counters first
 * All demo accounts use the password "demo1234".
 */
import bcrypt from 'bcryptjs';
import { connectDB, disconnectDB } from '../db.js';
import { User } from '../models/User.js';
import { Issue } from '../models/Issue.js';
import { Counter } from '../models/Counter.js';
import { analyzeText, computePriority, extractDetails, makeTitle } from '../ai/index.js';
import { dispatchFor } from '../ai/dispatch.js';
import { categoryById } from '../constants.js';

const PASSWORD = 'demo1234';

const USERS = [
  { key: 's1', name: 'Riya Sharma', email: 'student@bvcoe.edu.in', role: 'student', enrollment: '20811502823', branch: 'ECE' },
  { key: 's2', name: 'Aman Verma', email: 'aman@bvcoe.edu.in', role: 'student', enrollment: '20311502823', branch: 'ECE' },
  { key: 's3', name: 'Kabir Singh', email: 'kabir@bvcoe.edu.in', role: 'student', enrollment: '20711502823', branch: 'CSE' },
  { key: 's4', name: 'Neha Gupta', email: 'neha@bvcoe.edu.in', role: 'student', enrollment: '21011502823', branch: 'IT' },
  { key: 'a1', name: 'Facilities Desk', email: 'admin@bvcoe.edu.in', role: 'admin', title: 'Campus Administration' },
];

// n = ticket number, by = reporter, min = minutes ago
const REPORTS = [
  { n: 142, by: 's2', min: 35, cat: 'electrical', loc: 'ECE Lab 3', status: 'new', affected: 6,
    text: 'The switchboard near the back bench in ECE Lab 3 is sparking whenever someone plugs in a soldering iron. Exposed wire is visible behind the plate. Dangerous, please fix immediately.' },
  { n: 143, by: 's3', min: 21, cat: 'electrical', loc: 'ECE Lab 3', status: 'duplicate', affected: 1, dupOf: 142,
    text: 'Sparks coming out of the socket at the back of ECE lab 3 when plugging in the soldering station.' },
  { n: 131, by: 's1', min: 2 * 1440, cat: 'plumbing', loc: 'Block B – 2nd floor corridor', status: 'assigned', affected: 14, assignee: 'R. K. Yadav (plumber)',
    text: 'Water leaking from the ceiling in the Block B 2nd floor corridor since two days. The floor is slippery and students are walking around it.' },
  { n: 138, by: 's4', min: 300, cat: 'it', loc: 'Central Library', status: 'pending', affected: 23,
    text: 'Wi-Fi not working in the Central Library since morning. Cannot access the ERP portal or download notes, many students are affected.' },
  { n: 145, by: 's3', min: 40, cat: 'it', loc: 'Central Library', status: 'new', affected: 3,
    text: 'No internet in the library reading hall, wifi network shows connected but nothing loads.' },
  { n: 134, by: 's2', min: 1560, cat: 'sanitation', loc: 'Canteen', status: 'in_progress', affected: 9, assignee: 'Housekeeping shift B',
    text: 'The washroom next to the canteen is very dirty and there is no water in the taps. Bad smell spreading to the seating area.' },
  { n: 137, by: 's1', min: 540, cat: 'security', loc: 'Main gate / parking', status: 'assigned', affected: 2, assignee: 'Security supervisor',
    text: 'CCTV camera above the main gate is broken and hanging from its bracket. The parking area is not covered at all.' },
  { n: 140, by: 's4', min: 180, cat: 'transport', loc: 'Bus route 4 – Dwarka', status: 'new', affected: 11,
    text: 'Bus on route 4 is late every day by 25–30 minutes, students are missing the first lecture and attendance.' },
  { n: 126, by: 's3', min: 3 * 1440, cat: 'academic', loc: 'Block A – room 104', status: 'resolved', affected: 4,
    text: 'Projector in Block A room 104 is not working, the screen stays blue during lectures.' },
  { n: 139, by: 's2', min: 420, cat: 'hostel', loc: 'Boys Hostel – room 212', status: 'pending', affected: 2,
    text: 'Ceiling fan in Boys Hostel room 212 is not working for the last three days, too hot to sleep at night.' },
  { n: 144, by: 's1', min: 62, cat: 'infrastructure', loc: 'Auditorium', status: 'new', affected: 1,
    text: 'Three chairs in row F of the auditorium are broken, the seat comes off when you sit.' },
  { n: 146, by: 's4', min: 50, cat: 'security', loc: 'Girls Hostel', status: 'new', affected: 5,
    text: 'The back gate lock of the Girls Hostel is broken and the gate stays open at night. Unsafe, anyone can enter.' },
  { n: 121, by: 's2', min: 4 * 1440, cat: 'sanitation', loc: 'Canteen', status: 'resolved', affected: 7,
    text: 'Garbage bins near the canteen overflowing, attracting stray dogs and flies.' },
  { n: 135, by: 's3', min: 1440, cat: 'infrastructure', loc: 'Block A – lift', status: 'in_progress', affected: 8, assignee: 'Lift AMC vendor',
    text: 'The lift in Block A got stuck between floors with students inside for ten minutes. It is still running without any check.' },
  { n: 141, by: 's1', min: 120, cat: 'plumbing', loc: 'Block A – ground floor', status: 'new', affected: 1,
    text: 'Drinking water cooler on Block A ground floor is giving warm water.' },
];

const FLOW = ['new', 'pending', 'assigned', 'in_progress', 'resolved'];
const NOTES = { pending: 'Acknowledged by the facilities desk.', assigned: 'Routed to the department and assigned.', in_progress: 'Work started on site.', resolved: 'Marked fixed and verified.' };
const ago = (min) => new Date(Date.now() - min * 60000);

async function seedUsers() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const byKey = {};
  for (const { key, ...u } of USERS) {
    byKey[key] = await User.findOneAndUpdate({ email: u.email }, { $setOnInsert: { ...u, passwordHash: hash } }, { new: true, upsert: true });
  }
  return byKey;
}

async function seedIssues(users) {
  if (await Issue.countDocuments()) {
    console.log('Reports already exist – skipping sample reports (use npm run seed:reset to start fresh).');
    return;
  }
  const students = Object.values(users).filter((u) => u.role === 'student');
  const admin = users.a1;
  const idByNumber = {};
  const docs = [];

  for (const r of REPORTS) {
    const ai = await analyzeText(r.text, r.cat);
    const reporter = users[r.by];
    const others = students.filter((s) => String(s._id) !== String(reporter._id)).slice(0, Math.max(0, r.affected - 1));
    const createdAt = ago(r.min);
    const timeline = [{ status: 'new', at: createdAt, by: 'CampusCare AI', note: `Classified as ${categoryById(r.cat).label}, routed automatically.` }];
    if (r.status === 'duplicate') {
      timeline.push({ status: 'duplicate', at: ago(r.min - 2), by: admin.name, note: 'Merged into an earlier report of the same problem.' });
    } else {
      const steps = FLOW.slice(1, FLOW.indexOf(r.status) + 1);
      steps.forEach((s, i) => timeline.push({ status: s, at: ago(r.min * (1 - (i + 1) / (steps.length + 1))), by: admin.name, note: NOTES[s] }));
    }
    const priority = computePriority({ ...ai, affectedCount: r.affected });
    const acknowledged = r.status !== 'new' ? timeline[1]?.at || createdAt : null;
    const doc = new Issue({
      ticket: `CC-26-${String(r.n).padStart(4, '0')}`,
      title: makeTitle(r.text),
      description: r.text,
      category: r.cat,
      location: r.loc,
      occurredAt: createdAt,
      status: r.status,
      department: categoryById(r.cat).department,
      assignee: r.assignee || null,
      reporter: { id: reporter._id, name: reporter.name },
      affectedUsers: [reporter._id, ...others.map((o) => o._id)],
      affectedCount: r.affected,
      ai,
      priority,
      dispatch: { ...dispatchFor(ai, priority), sentAt: createdAt, acknowledgedAt: acknowledged, acknowledgedBy: acknowledged ? admin.name : null },
      extracted: { ...extractDetails(r.text, createdAt), locationSource: 'student', missing: [] },
      timeline,
      createdAt,
      updatedAt: timeline[timeline.length - 1].at,
    });
    idByNumber[r.n] = doc._id;
    docs.push({ doc, dupOf: r.dupOf });
  }

  docs.forEach(({ doc, dupOf }) => { if (dupOf) doc.duplicateOf = idByNumber[dupOf]; });
  const lift = docs.find(({ doc }) => doc.ticket === 'CC-26-0135').doc;
  lift.comments.push(
    { author: admin.name, authorId: admin._id, role: 'admin', text: 'Lift locked out until the AMC technician inspects it. Please use the stairs.', at: ago(1200) },
    { author: 'Kabir Singh', authorId: users.s3._id, role: 'student', text: 'Thanks. The emergency bell inside also did not ring.', at: ago(1080) }
  );

  // timestamps:false keeps the back-dated createdAt/updatedAt above
  await Issue.insertMany(docs.map(({ doc }) => doc), { timestamps: false });
  const highest = Math.max(...REPORTS.map((r) => r.n));
  await Counter.findOneAndUpdate({ _id: 'issue' }, { $max: { seq: highest - 100 } }, { upsert: true });
  console.log(`Inserted ${docs.length} sample reports. Next ticket: CC-26-${String(highest + 1).padStart(4, '0')}.`);
}

async function main() {
  await connectDB();
  if (process.argv.includes('--reset')) {
    await Promise.all([User.deleteMany({}), Issue.deleteMany({}), Counter.deleteMany({})]);
    console.log('Cleared users, reports and counters.');
  }
  const users = await seedUsers();
  console.log(`Demo accounts ready (password "${PASSWORD}"):`);
  USERS.forEach((u) => console.log(`  ${u.role.padEnd(7)} ${u.email}`));
  await seedIssues(users);
  await disconnectDB();
}

main().catch(async (err) => {
  console.error('Seeding failed:', err.message);
  await disconnectDB().catch(() => {});
  process.exit(1);
});

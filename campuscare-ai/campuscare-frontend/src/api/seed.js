// Demo data for the mock backend. Timestamps are relative to the moment the store is first created.
import { analyze, computePriority, makeTitle } from '../lib/triage.js';
import { categoryById } from '../lib/constants.js';
import { dispatchFor } from '../lib/dispatch.js';
import { extractDetails } from '../lib/extract.js';

export const USERS = [
  { id: 'u-stu-1', name: 'Riya Sharma', email: 'student@bvcoe.edu.in', role: 'student', enrollment: '20811502823', branch: 'ECE' },
  { id: 'u-stu-2', name: 'Aman Verma', email: 'aman@bvcoe.edu.in', role: 'student', enrollment: '20311502823', branch: 'ECE' },
  { id: 'u-stu-3', name: 'Kabir Singh', email: 'kabir@bvcoe.edu.in', role: 'student', enrollment: '20711502823', branch: 'CSE' },
  { id: 'u-stu-4', name: 'Neha Gupta', email: 'neha@bvcoe.edu.in', role: 'student', enrollment: '21011502823', branch: 'IT' },
  { id: 'u-adm-1', name: 'Facilities Desk', email: 'admin@bvcoe.edu.in', role: 'admin', title: 'Campus Administration' },
];

const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

const RAW = [
  { n: 142, by: 'u-stu-2', min: 35, cat: 'electrical', loc: 'ECE Lab 3', status: 'new', affected: 6,
    text: 'The switchboard near the back bench in ECE Lab 3 is sparking whenever someone plugs in a soldering iron. Exposed wire is visible behind the plate. Dangerous, please fix immediately.' },
  { n: 143, by: 'u-stu-3', min: 21, cat: 'electrical', loc: 'ECE Lab 3', status: 'duplicate', affected: 1, dupOf: 142,
    text: 'Sparks coming out of the socket at the back of ECE lab 3 when plugging in the soldering station.' },
  { n: 131, by: 'u-stu-1', min: 2 * 24 * 60, cat: 'plumbing', loc: 'Block B – 2nd floor corridor', status: 'assigned', affected: 14, assignee: 'R. K. Yadav (plumber)',
    text: 'Water leaking from the ceiling in the Block B 2nd floor corridor since two days. The floor is slippery and students are walking around it.' },
  { n: 138, by: 'u-stu-4', min: 5 * 60, cat: 'it', loc: 'Central Library', status: 'pending', affected: 23,
    text: 'Wi-Fi not working in the Central Library since morning. Cannot access the ERP portal or download notes, many students are affected.' },
  { n: 145, by: 'u-stu-3', min: 40, cat: 'it', loc: 'Central Library', status: 'new', affected: 3,
    text: 'No internet in the library reading hall, wifi network shows connected but nothing loads.' },
  { n: 134, by: 'u-stu-2', min: 26 * 60, cat: 'sanitation', loc: 'Canteen', status: 'in_progress', affected: 9, assignee: 'Housekeeping shift B',
    text: 'The washroom next to the canteen is very dirty and there is no water in the taps. Bad smell spreading to the seating area.' },
  { n: 137, by: 'u-stu-1', min: 9 * 60, cat: 'security', loc: 'Main gate / parking', status: 'assigned', affected: 2, assignee: 'Security supervisor',
    text: 'CCTV camera above the main gate is broken and hanging from its bracket. The parking area is not covered at all.' },
  { n: 140, by: 'u-stu-4', min: 3 * 60, cat: 'transport', loc: 'Bus route 4 – Dwarka', status: 'new', affected: 11,
    text: 'Bus on route 4 is late every day by 25–30 minutes, students are missing the first lecture and attendance.' },
  { n: 126, by: 'u-stu-3', min: 3 * 24 * 60, cat: 'academic', loc: 'Block A – room 104', status: 'resolved', affected: 4,
    text: 'Projector in Block A room 104 is not working, the screen stays blue during lectures.' },
  { n: 139, by: 'u-stu-2', min: 7 * 60, cat: 'hostel', loc: 'Boys Hostel – room 212', status: 'pending', affected: 2,
    text: 'Ceiling fan in Boys Hostel room 212 is not working for the last three days, too hot to sleep at night.' },
  { n: 144, by: 'u-stu-1', min: 62, cat: 'infrastructure', loc: 'Auditorium', status: 'new', affected: 1,
    text: 'Three chairs in row F of the auditorium are broken, the seat comes off when you sit.' },
  { n: 146, by: 'u-stu-4', min: 50, cat: 'security', loc: 'Girls Hostel', status: 'new', affected: 5,
    text: 'The back gate lock of the Girls Hostel is broken and the gate stays open at night. Unsafe, anyone can enter.' },
  { n: 121, by: 'u-stu-2', min: 4 * 24 * 60, cat: 'sanitation', loc: 'Canteen', status: 'resolved', affected: 7,
    text: 'Garbage bins near the canteen overflowing, attracting stray dogs and flies.' },
  { n: 135, by: 'u-stu-3', min: 24 * 60, cat: 'infrastructure', loc: 'Block A – lift', status: 'in_progress', affected: 8, assignee: 'Lift AMC vendor',
    text: 'The lift in Block A got stuck between floors with students inside for ten minutes. It is still running without any check.' },
  { n: 141, by: 'u-stu-1', min: 2 * 60, cat: 'plumbing', loc: 'Block A – ground floor', status: 'new', affected: 1,
    text: 'Drinking water cooler on Block A ground floor is giving warm water.' },
];

const FLOW = ['new', 'pending', 'assigned', 'in_progress', 'resolved'];
const NOTES = {
  pending: 'Acknowledged by the facilities desk.',
  assigned: 'Routed to the department and assigned.',
  in_progress: 'Work started on site.',
  resolved: 'Marked fixed and verified.',
};

export function buildSeed() {
  const byNumber = {};
  const issues = RAW.map((r) => {
    const id = `iss-${r.n}`;
    byNumber[r.n] = id;
    const ai = analyze(r.text, r.cat);
    const reporter = USERS.find((u) => u.id === r.by);
    const others = USERS.filter((u) => u.role === 'student' && u.id !== r.by).map((u) => u.id);
    const affectedUsers = [r.by, ...others.slice(0, Math.max(0, Math.min(others.length, r.affected - 1)))];
    const createdAt = ago(r.min);

    const timeline = [{ status: 'new', at: createdAt, by: 'CampusCare AI', note: `Classified as ${categoryById(r.cat).label}, routed automatically.` }];
    if (r.status === 'duplicate') {
      timeline.push({ status: 'duplicate', at: ago(r.min - 2), by: 'CampusCare AI', note: 'Merged into an earlier report of the same problem.' });
    } else {
      const steps = FLOW.slice(1, FLOW.indexOf(r.status) + 1);
      steps.forEach((s, i) => timeline.push({ status: s, at: ago(r.min * (1 - (i + 1) / (steps.length + 1))), by: 'Facilities Desk', note: NOTES[s] }));
    }

    const priority = computePriority({ ...ai, affectedCount: r.affected });
    const acknowledgedAt = r.status !== 'new' ? timeline[1]?.at || createdAt : null;
    return {
      id,
      ticket: `CC-26-${String(r.n).padStart(4, '0')}`,
      title: makeTitle(r.text),
      description: r.text,
      category: r.cat,
      location: r.loc,
      occurredAt: createdAt,
      createdAt,
      updatedAt: timeline[timeline.length - 1].at,
      images: [],
      status: r.status,
      department: categoryById(r.cat).department,
      assignee: r.assignee || null,
      reporter: { id: reporter.id, name: reporter.name },
      affectedUsers,
      affectedCount: r.affected,
      ai,
      priority,
      dispatch: { ...dispatchFor(ai, priority), sentAt: createdAt, acknowledgedAt, acknowledgedBy: acknowledgedAt ? 'Facilities Desk' : null, escalatedAt: null, escalations: 0 },
      extracted: { ...extractDetails(r.text, new Date(createdAt)), locationSource: 'student', missing: [] },
      duplicateOf: null,
      _dupOf: r.dupOf,
      comments: [],
      timeline,
    };
  });

  issues.forEach((i) => {
    if (i._dupOf) i.duplicateOf = byNumber[i._dupOf];
    delete i._dupOf;
  });

  const lift = issues.find((i) => i.id === 'iss-135');
  lift.comments.push(
    { id: 'c1', author: 'Facilities Desk', role: 'admin', text: 'Lift locked out until the AMC technician inspects it. Please use the stairs.', at: ago(20 * 60) },
    { id: 'c2', author: 'Kabir Singh', role: 'student', text: 'Thanks. The emergency bell inside also did not ring.', at: ago(18 * 60) }
  );

  return { issues, nextNumber: 147 };
}

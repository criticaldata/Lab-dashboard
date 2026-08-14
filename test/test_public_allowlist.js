// Verifies data.public.json (and its sample-data counterpart) NEVER carry
// any field beyond the explicit allowlist, and specifically never any of
// the named-sensitive fields — this is the automated enforcement for the
// "Project Discovery" security guarantee described in README.md. If a
// future change to export_data.py widens what gets written to
// data.public.json, this test fails.
//
// No server needed — run directly: node test/test_public_allowlist.js
const fs = require('fs');
const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('OK: ' + msg);
}

const ROOT = path.join(__dirname, '..');

const ALLOWED_KEYS = ['id', 'title', 'abstract', 'tags', 'skillsNeeded', 'stage', 'openToNewMembers', 'contact', 'whatsapp', 'teamMembers'].sort();

const FORBIDDEN_SUBSTRINGS = [
  'venue', 'deadline', 'notes', 'meetingLink', 'draftLink', 'currentDraftLink',
  'resources', 'history', 'submissions', 'priority', 'owner', 'authors',
  'targetVenue', 'targetDeadline', 'daysLeft', 'latestDecision', 'nextMeeting',
  'pastMeetings', 'progressPct', 'lastUpdated', 'githubRepo', 'finalFile',
  'status', 'currentVenue', 'attempts', 'publishedDate',
];

function checkFile(filePath, label) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert(Array.isArray(data.papers), label + ': has a papers array');

  data.papers.forEach((paper) => {
    const keys = Object.keys(paper).sort();
    assert(
      JSON.stringify(keys) === JSON.stringify(ALLOWED_KEYS),
      label + ': paper ' + paper.id + ' has EXACTLY the allowed key set, got [' + keys.join(', ') + ']'
    );

    // Belt-and-suspenders: check the raw JSON text for this one paper object
    // never mentions any forbidden field name at all (catches a forbidden
    // field nested inside e.g. `contact` too, not just top-level keys).
    const raw = JSON.stringify(paper);
    FORBIDDEN_SUBSTRINGS.forEach((word) => {
      const re = new RegExp('"' + word + '"', 'i');
      assert(!re.test(raw), label + ': paper ' + paper.id + ' JSON does not contain forbidden field "' + word + '"');
    });

    assert(paper.openToNewMembers === true, label + ': paper ' + paper.id + ' has openToNewMembers === true (nothing else should be exported)');
    assert(paper.contact && typeof paper.contact.email === 'string', label + ': paper ' + paper.id + ' has a contact.email string');
    assert(!('email' in paper), label + ': paper ' + paper.id + ' has no top-level raw "email" field');
  });
}

checkFile(path.join(ROOT, 'data.public.json'), 'data.public.json');
console.log("(data.public.json may currently have 0 papers if no spreadsheet paper is marked Open to New Members yet — that's expected, not a failure.)");

checkFile(path.join(ROOT, 'data.sample.public.json'), 'data.sample.public.json');
const sampleData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.sample.public.json'), 'utf-8'));
assert(sampleData.papers.length === 15, 'data.sample.public.json has exactly the 15 openToNewMembers fixture papers, got ' + sampleData.papers.length);

// Cross-check against the full data.sample.json to make sure the ones that
// were EXCLUDED really are the openToNewMembers:false ones, not an
// off-by-one filtering bug.
const fullSample = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.sample.json'), 'utf-8'));
const expectedOpenIds = fullSample.papers.filter((p) => p.openToNewMembers).map((p) => p.id).sort();
const actualPublicIds = sampleData.papers.map((p) => p.id).sort();
assert(JSON.stringify(expectedOpenIds) === JSON.stringify(actualPublicIds), 'Exactly the openToNewMembers:true papers made it into data.sample.public.json: ' + actualPublicIds.join(', '));

// Confirm the generic-lab-email fallback actually happened for owners
// without publicContactOk, and the real email only shows for the one who
// has it.
const s001 = sampleData.papers.find((p) => p.id === 'S001');
const s002 = sampleData.papers.find((p) => p.id === 'S002');
assert(s001.contact.email === 'test-owner-a@example.org', 'Owner with publicContactOk=true shows their real email');
assert(s002.contact.email === 'criticaldata-lab@mit.edu', 'Owner without publicContactOk falls back to the generic lab email');

console.log('\nALL FIELD-ALLOWLIST TESTS PASSED');

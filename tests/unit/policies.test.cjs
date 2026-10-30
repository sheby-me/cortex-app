// Unit tests for the pure validation / error-mapping logic. Run: npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const b = (m) => require(`../../.test-build/${m}`);

const { validatePersonName } = b("lib/name-policy");
const { checkUsernameFormat, cleanUsername, RESERVED_USERNAMES } = b("lib/username-policy");
const { checkEmail, checkPassword } = b("lib/email-policy");
const { friendlyMessage, UserError } = b("lib/friendly-errors");
const { isSafeStorageUrl } = b("lib/safe-url");
const { isAboutCortex, searchGuide, OUT_OF_SCOPE_REPLY, APP_GUIDE } = b("lib/app-guide");
const { validateOnboarding, buildOnboardingUpdate } = b("lib/onboarding-policy");
const { INSTITUTIONS, emailMatchesInstitution } = b("data/universities");

test("names: real names pass, junk fails", () => {
  for (const ok of ["Ayesha Khan", "Muhammad Ali Jinnah", "Noor-ul-Ain", "Sa'ad Ahmed", "محمد علی", "Ayesha  ".trim()]) {
    assert.equal(validatePersonName(ok).ok, true, ok);
  }
  for (const bad of ["", "A", "Ali123", "Ali_Khan", "Ali 😀", "Ali  Khan", "Ali.Khan", "-Ali", "Ali-", "Ali--Khan", "aaaaaa bbbb", "x".repeat(61), "<b>Ali</b>"]) {
    assert.equal(validatePersonName(bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(validatePersonName("  Ayesha Khan ").value, "Ayesha Khan"); // trimmed
});

test("usernames: format and reserved words", () => {
  assert.equal(cleanUsername("@Ayesha_Khan!"), "ayesha_khan");
  assert.equal(checkUsernameFormat("ayesha_khan").ok, true);
  for (const bad of ["", "ab", "a".repeat(21), "_ayesha", "ayesha_", "12345", "admin", "Cortex", "support"]) {
    assert.equal(checkUsernameFormat(bad).ok, false, bad);
  }
  assert.ok(RESERVED_USERNAMES.includes("admin"));
});

test("emails: typos and disposable domains are rejected, real ones pass", () => {
  assert.equal(checkEmail("ali@umt.edu.pk").ok, true);
  assert.equal(checkEmail("ali@gmial.com").ok, false);
  assert.match(checkEmail("ali@gmial.com").error, /gmail\.com/);
  assert.equal(checkEmail("x@mailinator.com").ok, false);
  assert.equal(checkEmail("not-an-email").ok, false);
  assert.equal(checkPassword("short1").ok, false);
  assert.equal(checkPassword("allletters").ok, false);
  assert.equal(checkPassword("password123").ok, false);
  assert.equal(checkPassword("Sunrise2026!").ok, true);
});

test("errors shown to users never contain Firebase codes or internals", () => {
  const origError = console.error;
  console.error = () => {}; // the layer logs details to the console on purpose
  try {
    const cases = [
      [{ code: "permission-denied", message: "Missing or insufficient permissions." }, /permission/i],
      [{ code: "auth/invalid-credential", message: "Firebase: Error (auth/invalid-credential)." }, /incorrect email or password/i],
      [{ code: "auth/unauthorized-domain", message: "Firebase: Error (auth/unauthorized-domain)." }, /isn't available on this web address/i],
      [{ code: "unavailable" }, /offline|busy/i],
      [new Error("TypeError: Cannot read properties of undefined (reading 'x')"), /something went wrong/i],
    ];
    for (const [err, expected] of cases) {
      const msg = friendlyMessage(err);
      assert.match(msg, expected);
      assert.doesNotMatch(msg, /auth\/|firebase|insufficient|undefined|TypeError|\[/i, msg);
    }
    assert.equal(friendlyMessage(new UserError("That username is already taken.")), "That username is already taken.");
    assert.match(friendlyMessage(new UserError("USERNAME_TAKEN")), /already taken/);
    assert.equal(friendlyMessage({ code: "functions/invalid-argument", message: "Use your official UMT email address." }), "Use your official UMT email address.");
  } finally {
    console.error = origError;
  }
});

test("only our own Storage bucket URLs may be opened", () => {
  assert.equal(isSafeStorageUrl("https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media"), true);
  for (const bad of ["javascript:alert(1)", "data:text/html,<script>", "http://firebasestorage.googleapis.com/x", "https://evil.example/x.png", "", null, 5]) {
    assert.equal(isSafeStorageUrl(bad), false, String(bad));
  }
});

test("help assistant scope gate: app questions in, everything else out", () => {
  for (const q of ["How do I change my username?", "How do I send a buddy request?", "Where are notifications?", "How do I create an SOS request?", "how to reset password", "how do i create a study room"]) {
    assert.equal(isAboutCortex(q), true, q);
  }
  for (const q of ["What is the capital of France?", "Write me a poem about the sea", "Solve 2x+3=7", "Who won the world cup?"]) {
    assert.equal(isAboutCortex(q), false, q);
  }
  assert.match(OUT_OF_SCOPE_REPLY, /only help with using Cortex/);
  assert.equal(searchGuide("how do I change my username")[0].id, "username");
  assert.ok(APP_GUIDE.every((e) => e.answer.length > 20 && e.keywords.length > 0));
  for (const e of APP_GUIDE.filter((x) => x.route)) assert.match(e.route, /^\/[a-z-]+$/, e.id);
});

test("university email domains: exact and sub-domain matches only", () => {
  const umt = INSTITUTIONS.find((i) => i.name.includes("(UMT)"));
  const nust = INSTITUTIONS.find((i) => i.name.includes("(NUST)"));
  assert.ok(umt && nust);
  assert.equal(emailMatchesInstitution("student@umt.edu.pk", umt), true);
  assert.equal(emailMatchesInstitution("student@mail.umt.edu.pk", umt), true);
  assert.equal(emailMatchesInstitution("student@student.nust.edu.pk", nust), true);
  assert.equal(emailMatchesInstitution("student@fakeumt.edu.pk", umt), false);
  assert.equal(emailMatchesInstitution("student@umt.edu.pk.evil.com", umt), false);
  assert.equal(emailMatchesInstitution("student@lums.edu.pk", umt), false);
  assert.equal(emailMatchesInstitution("nodomain", umt), false);
  // data sanity
  const ids = new Set();
  for (const i of INSTITUTIONS) {
    assert.ok(!ids.has(i.id), `duplicate id ${i.id}`);
    ids.add(i.id);
    if (i.type === "university") assert.ok(i.domains.length > 0, i.name);
    for (const d of i.domains) assert.match(d, /^[a-z0-9.-]+\.[a-z]{2,}$/, d);
  }
  const sorted = [...INSTITUTIONS].map((i) => i.name);
  assert.ok(sorted.length >= 200);
});

const good = { name: "Ayesha Khan", username: "ayesha_khan", usernameState: "free", usernameMessage: null, country: "Pakistan", institution: "University of Management and Technology (UMT)", level: "Undergraduate", timezone: "UTC+5 (PST, Pakistan Standard Time)" };

test("onboarding: valid input passes; every missing/invalid required field is reported", () => {
  assert.equal(validateOnboarding(good).valid, true);
  const cases = [
    [{ name: "" }, "name"], [{ name: "Ayesha 99" }, "name"],
    [{ username: "" }, "username"], [{ username: "admin" }, "username"], [{ usernameState: "taken", usernameMessage: "@ayesha_khan is already taken." }, "username"],
    [{ country: "" }, "country"], [{ institution: "   " }, "institution"], [{ level: "" }, "level"], [{ timezone: "" }, "timezone"],
  ];
  for (const [patch, field] of cases) {
    const r = validateOnboarding({ ...good, ...patch });
    assert.equal(r.valid, false, JSON.stringify(patch));
    assert.equal(r.firstInvalid, field, JSON.stringify(patch));
    assert.ok(r.firstError && r.firstError.length > 3);
  }
  // a username still being checked must not block the button (the transactional claim decides)
  assert.equal(validateOnboarding({ ...good, usernameState: "checking" }).valid, true);
});

test("onboarding: the saved payload is normalised and marks onboarding complete", () => {
  const u = buildOnboardingUpdate({ name: "  Ayesha Khan ", username: "@Ayesha_Khan", country: "Pakistan", institution: " UMT ", institutionId: "x", level: "Undergraduate", semester: " ", degree: "BSCS", timezone: "UTC+5", bio: "", teach: ["Math"], learn: [], hours: NaN });
  assert.equal(u.displayName, "Ayesha Khan");
  assert.equal(u.username, "ayesha_khan");
  assert.equal(u.institution, "UMT");
  assert.equal(u.semesterOrYear, null);
  assert.equal(u.about, null);
  assert.equal(u.hoursGoal, 5);
  assert.equal(u.onboarded, true);
});

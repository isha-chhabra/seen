import pg from "pg";
const NEW = process.argv[2];
const EMAIL = process.argv[3];
if (!NEW || !EMAIL) { console.error("usage: node setpw.mjs <newPassword> <email>"); process.exit(1); }
let hashPassword;
for (const s of ["better-auth/crypto", "better-auth"]) {
  try { const m = await import(s); if (typeof m.hashPassword === "function") { hashPassword = m.hashPassword; break; } } catch {}
}
if (!hashPassword) { console.error("no better-auth hashPassword export found"); process.exit(2); }
const hash = await hashPassword(NEW);
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(
  'update account a set password = $1, updated_at = now() from "user" u where a.user_id = u.id and a.provider_id = $3 and lower(u.email) = lower($2) returning a.id',
  [hash, EMAIL, "credential"]
);
console.log("rows updated:", r.rowCount);
await c.end();

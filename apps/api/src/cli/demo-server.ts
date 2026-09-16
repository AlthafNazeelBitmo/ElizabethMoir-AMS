import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { buildApp } from "../app.js";
import { hashPassword } from "../auth/password.js";
import { loadConfig } from "../config.js";
import * as schema from "../db/schema/index.js";
import {
  calendarDays,
  groups,
  people,
  tutors,
  users,
} from "../db/schema/index.js";

/**
 * The whole application against an in-process Postgres, with a small amount
 * of believable data in it.
 *
 * For development and for showing the thing working: no Docker, no managed
 * database, nothing to install. The data lives in memory and is gone when
 * the process stops, which is the point — it is a demonstration, not an
 * environment, and nothing here should ever be mistaken for one.
 *
 *   pnpm --filter @ams/api demo
 *
 * Then run the web app (pnpm --filter @ams/web dev) and sign in with the
 * credentials this prints.
 */

const DEMO_PASSWORD = "brass lantern quiet morning";
const DEVICE = "DEMO000000001";
const SCHOOL_TIMEZONE = "Asia/Colombo";

async function main(): Promise<void> {
  const client = new PGlite();
  await client.waitReady;
  const db = drizzle(client, { schema });

  const here = path.dirname(fileURLToPath(import.meta.url));
  await migrate(db, { migrationsFolder: path.resolve(here, "../../drizzle") });

  const config = loadConfig({
    NODE_ENV: "development",
    DATABASE_URL: "postgres://demo:demo@127.0.0.1:5432/demo",
    REPORT_TOKEN: "demo-report-token-0123456789abcdefghij",
    INGEST_PATH_TOKEN: "demo-ingest-token-abcdefghij",
    LOG_LEVEL: "warn",
    SPOOL_DIR: "./data/demo-spool",
    PORT: process.env["PORT"] ?? "3000",
    ...process.env,
  });

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await db.insert(users).values([
    {
      email: "head@school.example",
      passwordHash,
      fullName: "Head Teacher",
      role: "full",
      mustChangePassword: false,
    },
    {
      email: "office@school.example",
      passwordHash,
      fullName: "Office",
      role: "student_only",
      mustChangePassword: false,
    },
  ]);

  // The groups come from migration 0002; the demo only reads them.
  const groupRows = await db.select().from(groups);
  const groupId = (name: string) => groupRows.find((g) => g.name === name)!.id;

  const tutorRows = await db
    .insert(tutors)
    .values([
      { initials: "AP", fullName: "A Perera" },
      { initials: "RJ", fullName: "R Jayasinghe" },
    ])
    .returning();

  const firstNames = [
    "Ann",
    "Ben",
    "Chandi",
    "Dilhara",
    "Eshan",
    "Fathima",
    "Gayan",
    "Hiruni",
    "Ishara",
    "Janith",
    "Kavi",
    "Lakmini",
    "Malith",
    "Nadeesha",
    "Oshadi",
    "Pasan",
    "Ruwani",
    "Sahan",
    "Tharindu",
    "Uvindu",
  ];
  const surnames = [
    "Perera",
    "Silva",
    "Fernando",
    "Wickrama",
    "Gunawardena",
    "Bandara",
    "Rathnayake",
    "Jayasuriya",
  ];

  const studentGroups = ["Form 1", "Form 2", "Upper 6"];
  const rows: Array<typeof people.$inferInsert> = [];
  for (let i = 0; i < 90; i++) {
    rows.push({
      enrollNo: String(11000 + i),
      fullName: `${firstNames[i % firstNames.length]} ${surnames[Math.floor(i / firstNames.length) % surnames.length]}`,
      groupId: groupId(studentGroups[i % studentGroups.length]!),
      tutorId: tutorRows[i % tutorRows.length]!.id,
      admissionNo: `2024/${String(i + 1).padStart(3, "0")}`,
    });
  }
  for (let i = 0; i < 12; i++) {
    rows.push({
      enrollNo: String(2000 + i),
      fullName: `${firstNames[(i + 3) % firstNames.length]} ${surnames[(i + 2) % surnames.length]}`,
      groupId: groupId(i === 11 ? "External Staff" : "Junior Staff"),
    });
  }
  await db.insert(people).values(rows);

  // Dates must be the school's, not the server's: a machine in another
  // timezone would otherwise seed a calendar that the register never asks
  // about, and every screen would read "not expected".
  const schoolDate = (offsetDays = 0): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: SCHOOL_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  };

  const days: Array<typeof calendarDays.$inferInsert> = [];
  // A day either side of today as well, so the demo is not sensitive to
  // being started near midnight.
  for (let offset = 1; offset >= -21; offset--) {
    const iso = schoolDate(offset);
    const weekday = new Date(`${iso}T12:00:00Z`).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    days.push({ date: iso, type: weekend ? "weekend" : "school_day" });
  }
  await db.insert(calendarDays).values(days);

  const app = await buildApp({ config, db });
  await app.server.listen({ host: "127.0.0.1", port: config.PORT });

  const ingestUrl = `http://127.0.0.1:${config.PORT}/ingest/${config.INGEST_PATH_TOKEN}/raw`;

  // A morning's arrivals, so the screen is not empty on first load.
  const localDate = schoolDate(0);
  const arrivals = rows.slice(0, 55).map((person, i) => ({
    EmpId: person.enrollNo,
    AttTime: `${localDate} 0${7 + Math.floor(i / 30)}:${String((i * 2) % 60).padStart(2, "0")}:00`,
    CheckingStatus: "0",
    VerifyType: "1",
    DeviceID: DEVICE,
  }));
  await fetch(ingestUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(arrivals),
  });
  await app.whenIdle();

  console.log("");
  console.log("  Demo running on http://127.0.0.1:" + config.PORT);
  console.log("");
  console.log("  Sign in with either:");
  console.log(
    "    head@school.example    (sees students and staff, and admin)",
  );
  console.log("    office@school.example  (students only, no admin)");
  console.log(`    password: ${DEMO_PASSWORD}`);
  console.log("");
  console.log("  Send a scan to watch the register update live:");
  console.log(`    curl -X POST ${ingestUrl} \\`);
  console.log(`      -H 'content-type: application/json' \\`);
  console.log(
    `      -d '[{"EmpId":"11060","AttTime":"${localDate} 09:15:00","CheckingStatus":"0","DeviceID":"${DEVICE}"}]'`,
  );
  console.log("");
  console.log("  The database is in memory and disappears when this stops.");
  console.log("");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

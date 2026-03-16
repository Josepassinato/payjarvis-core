/**
 * Seed — creates initial admin user with a generated password.
 * Password is displayed ONCE in the terminal.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const prisma = new PrismaClient();

async function main() {
  const password = crypto.randomBytes(16).toString("hex");
  const hash = await bcrypt.hash(password, 12);

  const admin = await prisma.adminUser.upsert({
    where: { email: "jose@12brain.org" },
    create: {
      email: "jose@12brain.org",
      name: "José Passinato",
      role: "superadmin",
      passwordHash: hash,
    },
    update: {},
  });

  console.log("");
  console.log("═══════════════════════════════════════");
  console.log("  ADMIN CREDENTIALS — SAVE THIS NOW");
  console.log("═══════════════════════════════════════");
  console.log(`  Email:    ${admin.email}`);
  console.log(`  Password: ${password}`);
  console.log(`  Role:     ${admin.role}`);
  console.log("═══════════════════════════════════════");
  console.log("  This password is shown only ONCE!");
  console.log("═══════════════════════════════════════");
  console.log("");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

// prisma/seed.ts
// Seeds the database with test users and a sample document.
// Run: npm run db:seed

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // Create test users
  const passwordHash = await bcrypt.hash("Password123!", 12);

  const alice = await prisma.user.upsert({
    where: { email: "alice@example.com" },
    update: {},
    create: {
      email: "alice@example.com",
      name: "Alice Owner",
      passwordHash,
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: "bob@example.com" },
    update: {},
    create: {
      email: "bob@example.com",
      name: "Bob Editor",
      passwordHash,
    },
  });

  const carol = await prisma.user.upsert({
    where: { email: "carol@example.com" },
    update: {},
    create: {
      email: "carol@example.com",
      name: "Carol Viewer",
      passwordHash,
    },
  });

  // Create a sample document
  const sampleText = `Welcome to the Collaborative Editor

This is a sample document to get you started. Try editing this text and watch changes sync in real time across multiple browser tabs.

Features you can try:
- Edit text and go offline, then come back online to see sync work
- Open the document in two browser windows simultaneously  
- Use the Version History panel to create snapshots
- Invite collaborators with different roles

The editor uses Operational Transform to resolve conflicts when multiple users edit simultaneously — no data loss, ever.`;

  const doc = await prisma.document.create({
    data: {
      title: "Welcome Document",
      ownerId: alice.id,
      content: {
        ops: [],
        text: sampleText,
        metadata: {
          wordCount: sampleText.split(/\s+/).filter(Boolean).length,
          charCount: sampleText.length,
          lastEditedBy: alice.id,
        },
      },
      vectorClock: { [alice.id]: 1 },
      revision: 1,
      contentSize: Buffer.byteLength(sampleText, "utf-8"),
    },
  });

  // Add Bob as EDITOR and Carol as VIEWER
  await prisma.collaborator.createMany({
    data: [
      {
        documentId: doc.id,
        userId: bob.id,
        role: "EDITOR",
        acceptedAt: new Date(),
      },
      {
        documentId: doc.id,
        userId: carol.id,
        role: "VIEWER",
        acceptedAt: new Date(),
      },
    ],
    skipDuplicates: true,
  });

  // Create an initial version snapshot
  await prisma.documentVersion.create({
    data: {
      documentId: doc.id,
      createdById: alice.id,
      snapshot: {
        ops: [],
        text: sampleText,
        metadata: {},
      },
      revision: 1,
      label: "Initial version",
    },
  });

  console.log("✅ Seed complete!");
  console.log("\n Test accounts:");
  console.log("  alice@example.com / Password123! (Owner)");
  console.log("  bob@example.com   / Password123! (Editor)");
  console.log("  carol@example.com / Password123! (Viewer)");
  console.log(`\n  Document ID: ${doc.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

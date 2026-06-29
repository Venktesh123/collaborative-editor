// src/app/dashboard/page.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { NewDocumentButton } from "@/components/new-document-button";
import { formatDistanceToNow } from "@/lib/utils";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const userId = session.user.id;

  const documents = await prisma.document.findMany({
    where: {
      isDeleted: false,
      OR: [
        { ownerId: userId },
        { collaborators: { some: { userId } } },
      ],
    },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      ownerId: true,
      isPublic: true,
      owner: { select: { name: true, email: true } },
      collaborators: {
        where: { userId },
        select: { role: true },
      },
      _count: { select: { collaborators: true, versions: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return (
    <div className="min-h-screen" style={{ background: "var(--color-base)" }}>
      <header
        className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <span className="text-lg font-semibold tracking-tight">
          Collab<span style={{ color: "var(--color-accent)" }}>doc</span>
        </span>
        <div className="flex items-center gap-4">
          <span className="text-sm" style={{ color: "var(--color-text-2)" }}>
            {session.user.name ?? session.user.email}
          </span>
          <SignOutButton />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-semibold">Your documents</h1>
          <NewDocumentButton />
        </div>

        {documents.length === 0 ? (
          <div
            className="text-center py-20 rounded-xl border border-dashed"
            style={{ borderColor: "var(--color-border)" }}
          >
            <p className="text-lg font-medium mb-2">No documents yet</p>
            <p className="text-sm mb-6" style={{ color: "var(--color-text-2)" }}>
              Create your first document to get started
            </p>
            <NewDocumentButton label="Create document" />
          </div>
        ) : (
          <div className="grid gap-2">
            {documents.map((doc) => {
              // Fix: compare with Prisma enum values (uppercase)
              const collabRole = doc.collaborators[0]?.role;
              const role =
                doc.ownerId === userId
                  ? "Owner"
                  : collabRole === "EDITOR"
                  ? "Editor"
                  : collabRole === "VIEWER"
                  ? "Viewer"
                  : "Viewer";

              return (
                <Link
                  key={doc.id}
                  href={`/editor/${doc.id}`}
                  data-testid="document-item"
                  className="flex items-center justify-between px-5 py-4 rounded-lg transition-colors group"
                  style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate group-hover:text-indigo-400 transition-colors">
                      {doc.title}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-text-2)" }}>
                      Edited {formatDistanceToNow(doc.updatedAt)} · {doc.owner.name ?? doc.owner.email}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 ml-4 shrink-0">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{
                        background: role === "Owner" ? "#1e1b4b" : role === "Editor" ? "#14291f" : "#1f1f1f",
                        color: role === "Owner" ? "#a5b4fc" : role === "Editor" ? "#4ade80" : "#888",
                      }}
                    >
                      {role}
                    </span>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: "var(--color-text-3)" }}>
                      <path d="M6 12l4-4-4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
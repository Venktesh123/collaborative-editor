// src/app/editor/[id]/page.tsx
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getDocumentForUser } from "@/lib/prisma";
import { CollaborativeEditor } from "@/components/editor/collaborative-editor";
import type { DocumentDTO, DocumentContent } from "@/types/document";

type Params = { params: Promise<{ id: string }> };

export default async function EditorPage({ params }: Params) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { id } = await params;
  const access = await getDocumentForUser(id, session.user.id);

  if (!access) notFound();

  const { doc, role } = access;

  const documentDTO: DocumentDTO = {
    id: doc.id,
    title: doc.title,
    content: doc.content as unknown as DocumentContent,
    revision: doc.revision,
    vectorClock: (doc.vectorClock ?? {}) as Record<string, number>,
    ownerId: doc.ownerId,
    isPublic: doc.isPublic,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    userRole: role!,
  };

  return (
    <CollaborativeEditor
      document={documentDTO}
      user={{
        id: session.user.id,
        name: session.user.name ?? session.user.email ?? "Anonymous",
        email: session.user.email ?? "",
      }}
    />
  );
}
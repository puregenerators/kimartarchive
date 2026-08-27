import { NewArtworkBatchForm } from "@/components/artwork/NewArtworkBatchForm";
import { requireAuthenticatedPage } from "@/lib/auth/access";
import { getArchiveTargetDiagnostics } from "@/lib/submission/archive-target";

export const metadata = {
  title: "Add New Artwork · Kim Artwork Archive",
  description:
    "Prepare a batch of artworks from the same exhibition or documentation session.",
};

export default async function NewArtworkPage() {
  await requireAuthenticatedPage();
  const archiveTarget = getArchiveTargetDiagnostics();

  return (
    <main className="relative mx-auto w-full max-w-6xl flex-1 px-5 pb-16 pt-16 sm:px-8 md:pb-20 md:pt-28">
      <NewArtworkBatchForm archiveTarget={archiveTarget.target} />
    </main>
  );
}

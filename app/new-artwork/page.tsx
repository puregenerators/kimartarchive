import { NewArtworkBatchForm } from "@/components/artwork/NewArtworkBatchForm";
import { getArchiveTargetDiagnostics } from "@/lib/submission/archive-target";

export const metadata = {
  title: "Add New Artwork · Kim Artwork Archive",
  description:
    "Prepare a batch of artworks from the same exhibition or documentation session.",
};

export default function NewArtworkPage() {
  const archiveTarget = getArchiveTargetDiagnostics();

  return (
    <main className="relative mx-auto w-full max-w-6xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
      <NewArtworkBatchForm archiveTarget={archiveTarget.target} />
    </main>
  );
}

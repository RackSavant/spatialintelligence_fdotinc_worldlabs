import { ProjectStudio } from "@/components/studio/ProjectStudio";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectStudio projectId={id} />;
}

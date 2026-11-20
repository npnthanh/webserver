import { notFound } from "next/navigation";
import { ProjectConfigHeader } from "@/components/ProjectConfigHeader";
import { ReportConfigEditor } from "@/components/ReportConfigEditor";
import { getProjectFromDb } from "@/lib/server-projects";

export default async function ProjectReportConfigPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProjectFromDb(id);
  if (!project) notFound();
  return (
    <div className="mx-auto max-w-[1400px] p-6 lg:p-8">
      <ProjectConfigHeader project={project} />
      <ReportConfigEditor projectId={id} />
    </div>
  );
}

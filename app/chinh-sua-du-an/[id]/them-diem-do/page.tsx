import { notFound } from "next/navigation";
import { AddMeterPointForm } from "@/components/AddMeterPointForm";
import { getProjectFromDb } from "@/lib/server-projects";
import { projectConfigPath } from "@/lib/project-config";

/** Chỉ chấp nhận đường dẫn nội bộ của dự án này để quay về sau khi thêm (tránh open redirect). */
function safeReturnTo(value: string | string[] | undefined, projectId: string) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const prefix = `/du-an/${encodeURIComponent(projectId)}`;
  return raw === prefix || raw.startsWith(`${prefix}/`) || raw.startsWith(`${prefix}?`) ? raw : null;
}

export default async function ProjectAddMeterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { id } = await params;
  const { returnTo } = await searchParams;
  const project = await getProjectFromDb(id);
  if (!project) notFound();
  return (
    <AddMeterPointForm
      cancelHref={safeReturnTo(returnTo, id) ?? projectConfigPath(id)}
      projectId={id}
      configuredMeterTypes={project.meterTypes ?? []}
    />
  );
}

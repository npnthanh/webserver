export type ProjectConfigModule = "project-info" | "points" | "ghg" | "alerts" | "reports" | "add-meter";

export function matchProjectConfig(pathname: string): {
  projectId: string;
  module: ProjectConfigModule;
} | null {
  const projectInfoMatch = pathname.match(/^\/sua-du-an\/([^/]+)(?:\/chinh-sua)?\/?$/);
  if (projectInfoMatch) return { projectId: projectInfoMatch[1], module: "project-info" };

  const match = pathname.match(/^\/chinh-sua-du-an\/([^/]+)(?:\/([^/]+))?/);
  if (!match) return null;
  const projectId = match[1];
  const segment = match[2];
  if (segment === "khi-nha-kinh") return { projectId, module: "ghg" };
  if (segment === "canh-bao") return { projectId, module: "alerts" };
  if (segment === "bao-cao") return { projectId, module: "reports" };
  if (segment === "them-diem-do") return { projectId, module: "add-meter" };
  if (!segment) return { projectId, module: "points" };
  return { projectId, module: "points" };
}

export function projectConfigPath(projectId: string, module: ProjectConfigModule = "points") {
  if (module === "project-info") return `/sua-du-an/${projectId}`;
  if (module === "ghg") return `/chinh-sua-du-an/${projectId}/khi-nha-kinh`;
  if (module === "alerts") return `/chinh-sua-du-an/${projectId}/canh-bao`;
  if (module === "reports") return `/chinh-sua-du-an/${projectId}/bao-cao`;
  if (module === "add-meter") return `/chinh-sua-du-an/${projectId}/them-diem-do`;
  return `/chinh-sua-du-an/${projectId}`;
}

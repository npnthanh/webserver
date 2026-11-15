import { dbFetch, emitDbChange } from "@/lib/db-client";

export type NotificationType =
  | "project_created"
  | "project_delete_requested"
  | "project_deleted"
  | "project_delete_rejected"
  | "project_delete_cancelled";

export type AdminNotification = {
  id: number;
  type: NotificationType;
  projectId: string;
  projectName: string;
  actorName: string;
  /** "YYYY-MM-DD HH:MM:SS" theo UTC. */
  createdAt: string;
  unread: boolean;
  request?: {
    id: number;
    status: "pending" | "approved" | "rejected" | "cancelled";
    requestedByName: string;
    decidedByName: string | null;
    canDecide: boolean;
    canCancel: boolean;
  };
};

export type NotificationFeed = { items: AdminNotification[]; unread: number };

export function loadNotifications() {
  return dbFetch<NotificationFeed>("notifications");
}

/** Đánh dấu đã xem (khi mở chuông). */
export function markNotificationsSeen() {
  return dbFetch<NotificationFeed>("notifications", { method: "POST", body: JSON.stringify({ action: "seen" }) });
}

export async function decideProjectDeletion(requestId: number, decision: "approve" | "reject" | "cancel") {
  const result = await dbFetch<{ status: string }>("project-deletions", {
    method: "POST",
    body: JSON.stringify({ requestId, decision }),
  });
  emitDbChange("projects");
  emitDbChange("notifications");
  return result;
}

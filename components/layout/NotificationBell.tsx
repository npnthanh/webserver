"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  decideProjectDeletion,
  loadNotifications,
  markNotificationsSeen,
  type AdminNotification,
} from "@/lib/notifications";
import { formatStoredVietnam } from "@/lib/vietnam-time";

const POLL_MS = 30_000;

/** Chuông thông báo: dự án được khởi tạo, yêu cầu xoá dự án (duyệt / từ chối), dự án đã bị xoá. */
export function NotificationBell() {
  const [items, setItems] = useState<AdminNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  /** Các thông báo còn "mới" tại lúc mở chuông (để tô nổi, dù server đã đánh dấu đã xem). */
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(
    () =>
      loadNotifications()
        .then((feed) => {
          setItems(feed.items);
          setUnread(feed.unread);
        })
        // Mất kết nối tạm thời: giữ dữ liệu cũ, lần thăm dò sau sẽ thử lại.
        .catch(() => undefined),
    [],
  );

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onChanged = () => void refresh();
    window.addEventListener("ems-notifications-changed", onChanged);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      window.removeEventListener("ems-notifications-changed", onChanged);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setError("");
    setConfirmingId(null);
    setFreshIds(new Set(items.filter((item) => item.unread).map((item) => item.id)));
    try {
      const feed = await markNotificationsSeen();
      setItems(feed.items);
      setUnread(feed.unread);
    } catch {
      // Không đánh dấu được: vẫn mở danh sách hiện có.
    }
  }

  async function decide(item: AdminNotification, decision: "approve" | "reject" | "cancel") {
    if (!item.request) return;
    setBusyId(item.id);
    setError("");
    try {
      await decideProjectDeletion(item.request.id, decision);
      setConfirmingId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không xử lý được yêu cầu.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => void toggle()}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
        aria-label={unread > 0 ? `Thông báo (${unread} mới)` : "Thông báo"}
        aria-expanded={open}
        title="Thông báo dự án"
      >
        <BellIcon className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {/* Điện thoại: trải ngang màn hình ngay dưới header (nút chuông không nằm sát mép phải nên canh theo nút sẽ tràn ra ngoài). Từ sm trở lên: thả xuống dưới nút chuông như cũ. */}
      {open ? (
        <div className="fixed inset-x-3 top-[68px] z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-[380px]">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-800">Thông báo dự án</p>
            <span className="text-[11px] text-slate-400">{items.length ? `${items.length} gần nhất` : ""}</span>
          </div>
          {error ? (
            <p className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-700">{error}</p>
          ) : null}
          <ul className="max-h-[min(420px,calc(100dvh-160px))] divide-y divide-slate-100 overflow-y-auto">
            {items.length === 0 ? (
              <li className="px-4 py-10 text-center text-xs text-slate-400">Chưa có thông báo nào.</li>
            ) : (
              items.map((item) => {
                const meta = TYPE_META[item.type] ?? TYPE_META.project_created;
                const highlight = freshIds.has(item.id) || item.request?.canDecide;
                return (
                  <li key={item.id} className={`flex gap-3 px-4 py-3 ${highlight ? "bg-emerald-50/50" : ""}`}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                    <div className="min-w-0 flex-1">
                      {item.type === "meter_reset_suspected" ? (
                        <p className="text-xs leading-relaxed text-slate-700">
                          <span className="font-semibold text-slate-900">Hệ thống</span> {meta.verb}{" "}
                          {item.detail ? <span>{item.detail}</span> : null} · dự án{" "}
                          <Link
                            href={`/chinh-sua-du-an/${encodeURIComponent(item.projectId)}`}
                            className="font-semibold text-emerald-700 hover:underline"
                            onClick={() => setOpen(false)}
                          >
                            {item.projectName}
                          </Link>
                          <span className="text-slate-500">. Vào Điểm đo để nhập biên bản thay đồng hồ.</span>
                        </p>
                      ) : (
                      <p className="text-xs leading-relaxed text-slate-700">
                        <span className="font-semibold text-slate-900">{item.actorName}</span> {meta.verb}{" "}
                        {item.type === "project_deleted" ? (
                          <span className="font-semibold text-slate-900">{item.projectName}</span>
                        ) : (
                          <Link
                            href={`/du-an/${encodeURIComponent(item.projectId)}`}
                            className="font-semibold text-emerald-700 hover:underline"
                            onClick={() => setOpen(false)}
                          >
                            {item.projectName}
                          </Link>
                        )}
                        {item.type === "project_deleted" && item.request?.requestedByName ? (
                          <span className="text-slate-500"> (theo yêu cầu của {item.request.requestedByName})</span>
                        ) : null}
                      </p>
                      )}
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {formatStoredVietnam(item.createdAt) ?? item.createdAt}
                      </p>

                      {item.type === "project_delete_requested" && item.request ? (
                        <RequestActions
                          item={item}
                          confirming={confirmingId === item.id}
                          busy={busyId === item.id}
                          onAskConfirm={() => setConfirmingId(item.id)}
                          onCancelConfirm={() => setConfirmingId(null)}
                          onDecide={(decision) => void decide(item, decision)}
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const TYPE_META: Record<AdminNotification["type"], { verb: string; dot: string }> = {
  project_created: { verb: "đã khởi tạo dự án", dot: "bg-emerald-500" },
  project_delete_requested: { verb: "yêu cầu xoá dự án", dot: "bg-amber-500" },
  project_deleted: { verb: "đã duyệt xoá dự án", dot: "bg-rose-500" },
  project_delete_rejected: { verb: "đã từ chối xoá dự án", dot: "bg-slate-400" },
  project_delete_cancelled: { verb: "đã huỷ yêu cầu xoá dự án", dot: "bg-slate-400" },
  meter_reset_suspected: { verb: "nghi thay đồng hồ (chỉ số tụt, không hồi lại) ở", dot: "bg-amber-500" },
};

function RequestActions({
  item,
  confirming,
  busy,
  onAskConfirm,
  onCancelConfirm,
  onDecide,
}: {
  item: AdminNotification;
  confirming: boolean;
  busy: boolean;
  onAskConfirm: () => void;
  onCancelConfirm: () => void;
  onDecide: (decision: "approve" | "reject" | "cancel") => void;
}) {
  const request = item.request!;
  if (request.status !== "pending") {
    const label =
      request.status === "approved"
        ? `Đã duyệt xoá bởi ${request.decidedByName ?? "Admin"}`
        : request.status === "rejected"
          ? `Đã bị từ chối bởi ${request.decidedByName ?? "Admin"}`
          : "Người gửi đã huỷ yêu cầu";
    return <p className="mt-1.5 text-[11px] font-medium text-slate-500">{label}</p>;
  }

  if (request.canDecide) {
    if (confirming) {
      return (
        <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2">
          <p className="text-[11px] font-medium text-rose-700">
            Xoá vĩnh viễn dự án &quot;{item.projectName}&quot;? Không thể hoàn tác.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecide("approve")}
              className="rounded-md bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
            >
              {busy ? "Đang xoá…" : "Xác nhận xoá"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onCancelConfirm}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              Quay lại
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onAskConfirm}
          className="rounded-md bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
        >
          Duyệt xoá
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide("reject")}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
        >
          Từ chối
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-medium text-amber-700">Đang chờ Admin khác duyệt</span>
      {request.canCancel ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide("cancel")}
          className="text-[11px] font-semibold text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline disabled:opacity-60"
        >
          Huỷ yêu cầu
        </button>
      ) : null}
    </div>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

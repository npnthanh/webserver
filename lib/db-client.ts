export async function dbFetch<T>(
  resource: string,
  options: RequestInit & { query?: Record<string, string | undefined> } = {},
): Promise<T> {
  const { query, ...init } = options;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  let response: Response;
  try {
    response = await fetch(`/api/ems/${resource}${suffix}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    // Trình duyệt không nhận được phản hồi ("Failed to fetch"): mất mạng, hoặc máy chủ đang khởi động lại.
    throw new Error(
      "Không kết nối được tới máy chủ (mất mạng hoặc máy chủ đang khởi động lại). Dữ liệu chưa được lưu, vui lòng thử lại sau ít phút.",
    );
  }
  if (!response.ok) {
    const message = await response.text();
    let detail = "";
    try {
      const parsed = JSON.parse(message) as { error?: string };
      if (parsed.error) detail = parsed.error;
    } catch {
      // Không phải JSON (thường là trang lỗi HTML của hosting khi máy chủ quá tải / khởi động lại).
      detail =
        response.status >= 500
          ? `Máy chủ tạm thời không phản hồi (mã ${response.status}). Dữ liệu chưa được lưu, vui lòng thử lại sau ít phút.`
          : message.trim().slice(0, 200);
    }
    throw new Error(detail || `Yêu cầu tới máy chủ bị lỗi (mã ${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export function emitDbChange(resource: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(`ems-${resource}-changed`));
  }
}

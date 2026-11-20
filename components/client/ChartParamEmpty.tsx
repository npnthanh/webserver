/** Biểu đồ không còn tham số nào được chọn ở Cấu hình → Tham số biểu đồ. */
export function ChartParamEmpty({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      <p className="mt-1 text-xs text-slate-500">
        Chưa chọn tham số nào để hiển thị. Chọn tham số ở Cấu hình → Tham số biểu đồ.
      </p>
    </div>
  );
}

import { redirect } from "next/navigation";

/** Đường dẫn cũ: trang đã chuyển sang Hệ số phát thải → Công thức phát thải. */
export default function LegacyEmissionTemplatePage() {
  redirect("/he-so-phat-thai/cong-thuc");
}

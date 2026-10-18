# Phân tích cấu trúc landing page `viraailap.com` (bằng REA)

**Mục tiêu:** hiểu *cấu trúc, bố cục, hệ thiết kế, tương tác* để tự dựng lại một landing page tương đương bằng
code và nội dung của mình. **Không** sao chép logo, video, ảnh, hay nguyên văn nội dung của họ
(xem `DISCLAIMER.md` của REA: không hỗ trợ sao chép tài sản được bảo vệ).

Công cụ: [morluto/rea](https://github.com/morluto/rea) v6.5.0 (`list-browser-targets`, `inspect-web-page`,
`analyze-web-bundle`, `capture-web-screenshot`) gắn vào Chromium headless qua CDP, cộng thêm đọc HTML/CSS tĩnh.
Ngày quan sát: 2026-10-15. Chỉ trang chủ, không đăng nhập, không gửi form.

## 1. Stack quan sát được

| Hạng mục | Kết quả | Bằng chứng |
|---|---|---|
| Framework | Next.js (App Router, Turbopack), React | REA `analyze-web-bundle`: vendor fingerprint `Next.js` (high), `React` (medium); 12 script, 0 lỗi parse |
| Hosting | Vercel (có `data-dpl-id` / tham số `dpl=`) | HTML gốc |
| CSS | Tailwind v4 (biến `--spacing`, `--text-sm`, `--radius-*`), 1 file CSS ~73 KB | `/_next/static/.../*.css` |
| Font | Be Vietnam Pro (nội dung) + Bricolage Grotesque (tiêu đề), tự host qua `next/font` | 9 file woff2 |
| Ảnh | `next/image` (webp): logo, 3 ảnh mẫu `ta-*.webp`, nền hero là 1 file webp động | thẻ `<img>` |
| Video | 14 thẻ `<video>` loop/muted, mp4 tĩnh `/video/*.mp4`; phát khi vào khung nhìn | HTML + JS |
| Analytics/pixel | Không thấy `gtag`, `fbq` trong HTML ban đầu | tìm chuỗi |
| Form | Không có form trên trang chủ; CTA chuyển sang `/dang-ky?goi=...&ky=...` | liên kết |
| SEO | meta description, Open Graph (`vi_VN`, alt `en_US`), Twitter card; không có JSON-LD | `<head>` |
| i18n | `lang="vi"`, đường dẫn `/en` cho bản tiếng Anh, nút "VN · EN" | liên kết |

## 2. Sơ đồ trang (route)

Trang chủ `/` và các trang con: `/bang-gia`, `/chi-tiet`, `/demo`, `/prompt-minh-hoa`, `/kiem-tien`, `/hoi-dap`,
`/tai-ve`, `/dang-ky`, `/dang-nhap`, `/quen-mat-khau`, `/tai-khoan`, `/dieu-khoan`, `/bao-mat`, `/en`.
Anchor trên trang chủ: `#tinh-nang`, `#ap-dung`, `#chi-phi`, `#so-video`, `#combo`.

## 3. Cấu trúc trang chủ (từ trên xuống)

1. **Header dính** (`sticky top-0`, cao 78px): logo + tên, thanh điều hướng dạng "pill" (ẩn dưới `xl`, thay bằng menu mobile),
   nút chuyển ngôn ngữ, "Đăng nhập" (ghost), CTA chính màu xanh có mũi tên.
2. **Hero** (`min-h-[100svh]`, header đè lên bằng `-mt-[78px]`): nền ảnh webp động toàn màn hình (`nen-mo-dau-...webp`) phủ lớp tối dần xuống dưới;
   H1 hai dòng với cụm từ khoá tô màu xanh chanh; 2 nút (CTA chính + nút phụ); thẻ kính mờ 2×2 chứa 4 số liệu.
3. **Tính năng** (`#tinh-nang`): tiêu đề giữa trang + đoạn mô tả; lưới thẻ cho 4 tính năng, mỗi thẻ có
   video/ảnh minh hoạ, tiêu đề, mô tả, danh sách ✓. Một thẻ có danh sách trạng thái giả lập (hàng đợi render).
4. **Áp dụng** (`#ap-dung`, nền `bg-sau`): 3 thẻ use-case, mỗi thẻ có video dọc 9:16 + 3 gạch đầu dòng.
5. **Chi phí / so sánh** (`#chi-phi`): bảng so sánh giá 3 dòng (2 đối thủ + sản phẩm), có thanh tỉ lệ và chú thích nguồn/ngày.
6. **Bảng giá rút gọn** (`#so-video`, `#combo`): tab chọn model (2 nút), nút chọn kỳ hạn (1 tháng / 6 tháng −43% / 1 năm −57%),
   2 thẻ gói (Pro / Unlimited) với danh sách ✓/✕ và nút "Mua gói này", banner combo −20%, ghi chú thanh toán.
7. **CTA cuối** (nền tối): thông điệp quyền riêng tư/chạy trên máy người dùng + 2 nút.
8. **Footer** (`bg-bg-sau`): 3 cột liên kết (Sản phẩm / Hỗ trợ / Tài khoản), miễn trừ trách nhiệm, thông tin pháp nhân, liên kết điều khoản & bảo mật.

## 4. Hệ thiết kế (token trích từ CSS công khai)

Hai chủ đề (sáng/tối) cùng bộ biến. Màu là giá trị chức năng nên dùng lại làm khởi điểm, đổi theo thương hiệu của mình.

| Token | Sáng | Tối |
|---|---|---|
| `--bg` | `#fff` | `#070a08` |
| `--bg-sau` (nền phụ) | `#f3f6f3` | (tối, gần `--bg`) |
| `--surface` / `--surface-2` | `#fff` / `#eef2ee` | `#121a14` / `#18221a` |
| `--ink` / `--ink-2` / `--ink-3` | `#0f1a12` / `#3f4d43` / `#56665a` | `#fff` / `#c2cfc5` / `#94a89a` |
| `--line` / `--line-soft` | `#bcc8be` / `#dfe6e0` | `#334437` / `#202c23` |
| `--accent` | `#0a6e36` | `#7ee85c` (chữ nhấn) |
| nút chính | `#0ac86e` (hover đậm `#0ab062`), chữ `#04120a` | cùng |

- Bo góc: `--radius: 14px`, `--radius-lon: 24px`, nút/pill bo tròn hoàn toàn.
- Bóng: `--shadow`, `--shadow-sau`, `--shadow-noi` (bóng ngả xanh cho nút nổi bật).
- Chuyển động: `--cd-nhanh .16s`, `--cd-vua .38s`, `--cd-cham .62s`; easing `cubic-bezier(.22,1,.36,1)` và `(.45,0,.55,1)`.
- Hiệu ứng "hiện dần" (`.hien-dan`) có script dự phòng sau 4s để không bao giờ để nội dung bị ẩn.
- Chữ: tiêu đề Bricolage Grotesque đậm, rất chặt (tracking âm); thân Be Vietnam Pro.

## 5. Tương tác ở phía client

Mức tin cậy: **[đã kiểm]** = thấy trực tiếp trong JS/HTML qua REA và đọc chunk; **[suy ra]** = chỉ suy từ HTML, chưa xác nhận hành vi.

- **[đã kiểm]** Hiện dần khi cuộn: `IntersectionObserver` thêm thuộc tính `data-thay` cho phần tử `.hien-dan`
  (`rootMargin: 0 0 -12% 0`, `threshold: .08`); script inline dự phòng sau 4s gỡ ẩn tất cả, nên nội dung không bao giờ bị kẹt ẩn.
- **[đã kiểm]** Video tải lười: có `IntersectionObserver` (`rootMargin` 200px/600px) chỉ gắn/chạy video khi gần khung nhìn.
  Mọi `<video>` đều `muted loop`, nguồn mp4 tĩnh `/video/*.mp4` (một vài file dùng lại ở nhiều thẻ).
- **[đã kiểm]** Có xử lý `prefers-reduced-motion` và `prefers-color-scheme` trong bundle; `<html>` mang `data-kieu-ve="thanh-pham"`
  (thuộc tính chọn bộ token).
- **[đã kiểm]** Trang chủ không gọi API: trong cửa sổ quan sát 3s, `requests: []`, `websocket_connections: []`
  (lưu ý REA chỉ ghi request phát sinh sau khi gắn vào, nên con số này chưa phải bằng chứng đầy đủ).
- **[suy ra]** Tab chọn model và nút kỳ hạn (1 tháng / 6 tháng / 1 năm) đổi giá và đổi liên kết "Mua gói này"
  (`/dang-ky?goi=veo-pro&ky=12`, `...&combo=1`). Logic nằm trong chunk tải lười, chưa đọc.
- **[suy ra]** Menu mobile cho thanh điều hướng (nav chính ẩn dưới breakpoint `xl`).
- **[suy ra]** Chuyển ngôn ngữ bằng đường dẫn (`/` ↔ `/en`), không dùng i18n client.

## 6. Giới hạn của lần quan sát này

- Chỉ chụp khung nhìn đầu (1440×900); chưa chụp full-page, chưa kiểm tra mobile.
- REA là công cụ *thụ động*: không bấm tab/nút nên giá theo kỳ hạn mới thấy qua HTML, chưa kiểm chứng hành vi bằng scenario.
- Chưa phân tích các trang con (`/bang-gia`, `/demo`, ...). Có thể làm tiếp nếu cần.
- Giá, số liệu và nội dung marketing là của họ; bản dựng lại dùng nội dung giữ chỗ.

## 7. Bản dựng lại

Xem `landing/` (HTML/CSS/JS thuần, không build step). Nội dung nằm trong `landing/content.js` để dễ đổi
thương hiệu, giá và chữ. Video/ảnh là nền gradient và khung giữ chỗ, thay bằng tài sản của mình.

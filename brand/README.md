# Skyloom brand kit

## Ý tưởng
Chữ **S** được dệt từ **ba sợi tơ** song song (cái "loom"), đặt trên nền chuyển màu **xanh ngọc → tím** (cái "sky"). Hai sợi ngoài so le ở hai đầu như chỉ thừa. Ở cỡ nhỏ ba sợi gộp thành một nét S đặc, nên có bản **favicon** riêng dùng một nét liền.

## Tệp (trong `svg/` và `png/`)
| Tệp | Dùng khi |
|---|---|
| `skyloom-icon.svg`, `png/skyloom-icon-{1024,512,256,128}.png` | Biểu tượng ứng dụng, avatar, ảnh đại diện (góc bo sẵn, nền trong suốt) |
| `skyloom-icon-square.svg`, `png/apple-touch-icon.png` | Cần ô vuông đầy (iOS, biểu tượng "maskable") |
| `skyloom-favicon.svg`, `png/favicon-{16,32,48}.png`, `png/favicon.ico` | Tab trình duyệt và mọi cỡ dưới 32 px (một nét S đặc) |
| `skyloom-logo.svg` | Logo ngang trên **nền sáng** |
| `skyloom-logo-dark.svg` | Logo ngang trên **nền tối** |
| `skyloom-logo-ink.svg`, `skyloom-logo-white.svg` | Một màu (in, dấu, nền ảnh): đen mực / trắng |
| `skyloom-glyph.svg`, `-white.svg`, `-ink.svg` | Chỉ chữ S, không ô vuông |
| `png/og-image.png` | Ảnh chia sẻ 1200×630 (cần đặt ở địa chỉ tuyệt đối khi dùng cho `og:image`) |

## Màu
| Tên | Mã | Dùng cho |
|---|---|---|
| Xanh ngọc (Sky) | `#8be9ff` | Điểm nhấn trên nền tối, đầu chuyển màu |
| Tím (Loom) | `#6a58f0` | Nút, giữa chuyển màu |
| Tím đậm | `#3b25b8` | Cuối chuyển màu |
| Tím chữ | `#4630c8` | Chữ "loom" trên nền sáng (đủ tương phản) |
| Mực | `#14112b` | Chữ "Sky" trên nền sáng |
| Đêm | `#060914` | Nền tối |

Chuyển màu của ô vuông: từ góc trên-trái xanh ngọc → tím ở 45% → tím đậm ở góc dưới-phải.

## Quy tắc
- **Chừa khoảng trống** quanh logo bằng ¼ chiều cao của ô vuông ở mọi phía.
- **Cỡ tối thiểu:** logo ngang rộng ≥ 96 px; biểu tượng ≥ 32 px (dưới đó dùng bản favicon).
- Chữ "Sky" và "loom" khác màu (mực/trắng và tím/xanh ngọc); không đổi thứ tự, không thêm viền hay bóng đổ.
- Trên ảnh hoặc nền nhiễu dùng bản một màu; không kéo giãn, không xoay, không đổi màu ngoài bảng trên.

## Tái tạo
```bash
pip install fonttools
python3 brand/build.py                  # sinh lại brand/svg/*
npm i playwright-core                   # chỉ cần cho PNG
CHROMIUM=/đường/dẫn/chromium node brand/export.mjs   # sinh brand/png/* (cần ImageMagick `convert` cho favicon.ico)
```
Chữ "Skyloom" dùng phông **Inter ExtraBold** (SIL Open Font License 1.1, https://github.com/rsms/inter), đã chuyển thành đường vector nên các tệp SVG không cần cài phông. Biểu tượng này đã được gắn vào app desktop (`skyloom-app/build/icon.png`, electron-builder tự tạo `.ico`/`.icns`), bản web (`skyloom-app/public/`), trang đăng nhập và landing.

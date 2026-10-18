# landing

Landing page HTML/CSS/JS thuần (không build step), dựng lại **cấu trúc và hệ thiết kế** đã phân tích ở
`docs/viraai-landing-analysis.md`. Thương hiệu là **Skyloom**; giá và số liệu so sánh vẫn là **giữ chỗ**; không dùng logo, video, ảnh hay nguyên văn của trang gốc.

```
cd landing && python3 -m http.server 8000   # mở http://localhost:8000
```

- `content.js`: toàn bộ chữ, giá, kỳ hạn, footer. Đổi thương hiệu tại đây và ở `index.html`.
- `styles.css`: token màu/bo góc/chuyển động ở `:root` và `.toi` (khu vực tối).
- `main.js`: render danh sách, tab model và kỳ hạn, menu mobile, hiện dần khi cuộn (có dự phòng 4s).
- Việc cần làm: thay khung giữ chỗ bằng video/ảnh thật của mình, thêm trang con, bản tiếng Anh, form đăng ký.

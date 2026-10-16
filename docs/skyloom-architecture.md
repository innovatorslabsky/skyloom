# Skyloom: kiến trúc đa nhà cung cấp

## Mục tiêu và nguyên tắc

Ứng dụng máy tính tạo video/ảnh AI hàng loạt, chạy trên máy người dùng, **dùng khoá API của chính họ**.
"Rẻ" đến từ việc kiểm soát chi phí, không đến từ việc lách giới hạn của nhà cung cấp.

**Không làm (non-goals), có chủ ý:**
- Không xoay nhiều tài khoản để vượt hạn mức hay gói miễn phí. Gặp giới hạn thì chờ (`Retry-After`, RPM), không đổi danh tính.
- Không xoá watermark/logo chìm, không tự động hoá giao diện web của dịch vụ để né API chính thức.
- Không đưa khoá API qua máy chủ của Skyloom. Khoá nằm trên máy người dùng.

## Các lớp

```
Giao diện (Electron/Tauri, sau này)
        │
   skyloom-core  (thư viện này)
   ├─ Registry   : danh sách nhà cung cấp người dùng đã bật + cách định tuyến
   ├─ JobQueue   : đồng thời, RPM, retry/backoff, fallback, huỷ
   ├─ Budget     : giữ chỗ ngân sách trước khi gọi
   ├─ pipeline   : ý tưởng → (văn bản) → video, ước tính trước khi chạy
   └─ providers  : openAiCompatText, mock, (bộ chuyển đổi video: sẽ thêm)
        │
 Nhà cung cấp bên ngoài (qua API chính thức, khoá của người dùng)
```

Giao diện nhà cung cấp rất nhỏ: `kinds`, `estimate(call)`, `run(call, signal)`, tuỳ chọn `rpm`, `maxConcurrent`.
Thêm một nhà cung cấp mới chỉ là viết một đối tượng thoả giao diện đó, lõi không cần sửa.

## Phân vai theo loại việc

| Việc | Nhà cung cấp phù hợp | Ghi chú |
|---|---|---|
| Viết kịch bản, tách cảnh, sinh prompt (văn bản) | Nhà cung cấp tương thích chat-completions, gồm các gói miễn phí để thử nghiệm | Gói miễn phí của NVIDIA ghi là để thử nghiệm/prototype và có giới hạn ~40 RPM (số cộng đồng báo lại); đọc điều khoản trước khi dùng cho sản phẩm bán ra |
| Tạo ảnh | Tuỳ chọn, rẻ hơn video | Dùng làm khung đầu cho image-to-video để tiết kiệm |
| Tạo video | Cần chọn nhà cung cấp, đọc giá hiện hành | Trả theo giây; API bất đồng bộ nên dùng `pollUntilDone` |

Chưa xác nhận được nhà cung cấp nào có **video miễn phí** qua API. Đừng hứa với người dùng điều đó.

## Luồng một lô

1. Người dùng dán danh sách ý tưởng, chọn độ dài/tỉ lệ/độ nét, đặt **ngân sách tối đa**.
2. `estimateBatch` báo giá bằng nhà cung cấp rẻ nhất: "N video × giá ≈ tổng". Người dùng xác nhận.
3. `runBatch` chạy từng ý tưởng: (tuỳ chọn) văn bản mở rộng prompt, rồi video.
4. Mỗi lần gọi: `Budget.reserve` → chờ slot và RPM → gọi → `commit`. Lỗi tạm thời: chờ rồi thử lại; lỗi vĩnh viễn: sang nhà cung cấp kế; hết ngân sách: dừng cả lô.
5. Kết quả lưu vào thư mục trên máy người dùng, kèm prompt gốc để nhân bản mẫu hiệu quả.

## Các cách giữ chi phí thấp (đã có sẵn trong thiết kế)

- Báo giá trước, trần ngân sách cứng, không tính tiền cho lần gọi thất bại.
- Định tuyến `cheapest` giữa các nhà cung cấp cùng loại.
- Bản nháp bằng model rẻ/độ nét thấp, chỉ render bản cuối bằng model đắt (đặt trong `BatchSpec`).
- Văn bản (rẻ hoặc miễn phí) làm việc nặng về ý tưởng; video chỉ trả tiền cho prompt đã chốt.

## Bước tiếp theo

1. Chọn nhà cung cấp video đầu tiên, đọc tài liệu và bảng giá hiện hành, viết bộ chuyển đổi (submit + `pollUntilDone`).
2. ~~Lưu khoá bằng kho khoá hệ điều hành + màn hình nhà cung cấp~~ — đã có (`safeStorage`, từ chối lưu khi không có keyring).
3. ~~Vỏ ứng dụng + màn hình lô~~ — đã có ở `skyloom-app/` (Electron). Còn thiếu: đóng gói bộ cài, thử Windows/macOS.
4. Lưu lịch sử lô và kho prompt cục bộ (SQLite).
5. Điều khoản/giấy phép: kiểm tra từng nhà cung cấp trước khi cho người dùng bật.

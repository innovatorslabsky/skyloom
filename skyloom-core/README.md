# skyloom-core

Lõi tạo video/ảnh hàng loạt **đa nhà cung cấp** cho Skyloom. Thư viện TypeScript, không có phụ thuộc runtime.
Thiết kế và ranh giới an toàn: [`../docs/skyloom-architecture.md`](../docs/skyloom-architecture.md).

```
npm install
npm run typecheck
npm test
```

- `Registry`: các nhà cung cấp mà người dùng đã cấu hình (mỗi nơi một khoá API của chính họ), định tuyến theo thứ tự ưu tiên hoặc theo giá ước tính.
- `JobQueue`: hàng đợi có giới hạn số job chạy cùng lúc, giới hạn RPM theo từng nhà cung cấp, thử lại có backoff (tôn trọng `Retry-After`), chuyển sang nhà cung cấp kế khi lỗi vĩnh viễn, huỷ bằng `AbortSignal`.
- `Budget`: trần chi tiêu cứng. Ngân sách được giữ chỗ **trước** mỗi lần gọi nên lô lớn dừng trước khi vượt, không phải báo sau.
- `estimateBatch` / `runBatch`: ước tính giá cả lô trước khi chạy; mỗi ý tưởng đi qua bước viết prompt (văn bản) rồi tạo video, một mục lỗi không làm hỏng cả lô.
- `pollUntilDone`: vòng chờ cho API video bất đồng bộ (gửi job, hỏi trạng thái) có hạn chót.
- `openAiCompatText`: nhà cung cấp văn bản cho mọi API kiểu chat-completions (ví dụ catalog của NVIDIA). `mockProvider`: chạy thử không tốn tiền.

Chưa có: bộ chuyển đổi cho API video cụ thể (cần chọn nhà cung cấp và đọc tài liệu/giá hiện hành), lưu khoá vào keychain, giao diện máy tính.

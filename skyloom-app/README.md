# skyloom-app

Vỏ ứng dụng máy tính của Skyloom (Electron + Vite, TypeScript, không dùng framework giao diện).
Lõi xử lý nằm ở [`../skyloom-core`](../skyloom-core); thiết kế ở [`../docs/skyloom-architecture.md`](../docs/skyloom-architecture.md).

```
npm install            # cài cả binary Electron
npm run dev            # giao diện trên trình duyệt, chế độ chạy thử (nhà cung cấp giả)
npm start              # build rồi mở cửa sổ Electron thật
npm test && npm run typecheck
```

## Ranh giới an toàn

- Lõi chạy ở **tiến trình chính**. Giao diện không có mạng (CSP `default-src 'none'`), không có Node, chỉ gọi 8 hàm cố định qua `contextBridge`.
- **Khoá API** được gửi một lần từ giao diện, mã hoá bằng `safeStorage` của hệ điều hành, lưu `keys.json` (quyền 0600) và không có hàm nào đọc ngược lại ra giao diện.
- Nếu hệ điều hành không có kho khoá an toàn (Linux không keyring dùng backend `basic_text`), ứng dụng **từ chối lưu khoá** thay vì lưu thường.
- Địa chỉ API phải là `https` (chỉ cho `http` với localhost), không chấp nhận tài khoản/mật khẩu trong địa chỉ.
- Cửa sổ không cho mở popup hay điều hướng đi nơi khác; liên kết `https` mở bằng trình duyệt hệ thống.
- Mỗi lô ghi một bản `batch.json` (yêu cầu + kết quả, không có khoá) vào `Documents/Skyloom/<thời gian>/`.

## Đã kiểm

- 15 test (dịch vụ, kho khoá mã hoá, kiểm tra đầu vào) và typecheck.
- Chế độ chạy thử trên Chromium: báo giá, chạy lô 4 video, thử lại lỗi, huỷ, trần ngân sách.
- Electron thật dưới Xvfb: cầu nối đúng 8 hàm, không lộ `require`/`process`, từ chối `http`, từ chối lưu khoá khi không có keyring.

## Chưa có

- **Nhà cung cấp video thật.** Khi chưa có, bản desktop không chạy được lô thật (chỉ chế độ chạy thử có nhà cung cấp giả).
- Chưa thử trên Windows/macOS, chưa đóng gói bộ cài (electron-builder), chưa có lịch sử lô, chưa tải file media về máy.

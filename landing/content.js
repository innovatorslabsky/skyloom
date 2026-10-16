// Toàn bộ chữ và giá nằm ở đây. Tên thương hiệu: Skyloom. Giá và số liệu so sánh vẫn là GIỮ CHỖ, hãy thay bằng số thật.
window.CONTENT = {
  brand: "Skyloom",
  features: [
    { title: "Mô hình A: hình đẹp, có âm thanh", text: "Clip ngắn chất lượng cao kèm tiếng, hợp cho bán hàng, giáo dục và hoạt hình.",
      bullets: ["Clip 8 giây có âm thanh", "Nâng lên 1080p", "Nhiều video song song trên mỗi tài khoản"], media: "Video minh hoạ mô hình A" },
    { title: "Mô hình B: dài hơn, chạy đều", text: "Nhẹ máy, chạy đều hàng trăm clip mỗi ngày cho nội dung ngắn liên tục.",
      bullets: ["Clip tới 30 giây", "Dọc 9:16 hoặc ngang 16:9", "Hàng trăm clip mỗi ngày"], media: "Video minh hoạ mô hình B" },
    { title: "Tạo ảnh hàng loạt", text: "Mỗi dòng một mô tả, chạy cả danh sách một lượt, rồi biến ảnh thành khung đầu của video.",
      bullets: ["Độ nét 1K và 2K", "Cả lô trong một lượt", "Từ ảnh sang video một chạm"], media: "Ảnh minh hoạ" },
    { title: "Đa luồng, tốc độ cao", text: "Đưa cả kịch bản vào hàng đợi, Skyloom chia sợi cho nhiều tài khoản chạy cùng lúc.",
      bullets: ["Tối đa 8 luồng, hoặc không giới hạn", "Tự xoay tài khoản khi hết lượt", "Tự thử lại khi gặp lỗi tạm"],
      queue: [["Sóng biển lúc hoàng hôn", "Đang render"], ["Mở hộp sản phẩm từ trên xuống", "Đang tải về"], ["Núi lúc bình minh, sương tan", "Đang render"], ["Phố cổ về đêm", "✓ Xong"]] }
  ],
  usecases: [
    { title: "Video giới thiệu sản phẩm", text: "Dựng nhanh nhiều biến thể cho mỗi sản phẩm để thử quảng cáo, giữ nhân vật và bối cảnh nhất quán.",
      bullets: ["Nhiều biến thể để thử nghiệm", "Nhất quán nhân vật qua các phân đoạn", "Tăng số lượng video dễ dàng"], media: "Video dọc 9:16" },
    { title: "Làm phim ngắn bằng AI", text: "Theo kịch bản riêng, nối nhiều clip thành chuỗi cảnh liền mạch và xuất ra một file.",
      bullets: ["Nối clip thành một file", "Có tiếng, nâng 1080p trong ứng dụng", "Trình chỉnh sửa nhiều track"], media: "Video dọc 9:16" },
    { title: "Nội dung ngắn cho mạng xã hội", text: "Đổ danh sách ý tưởng vào hàng đợi và để phần mềm chạy song song, kể cả qua đêm.",
      bullets: ["Chạy cả danh sách một lượt", "Tự xoay tài khoản, tự thử lại", "Kho lưu kèm câu lệnh gốc để nhân bản mẫu hiệu quả"], media: "Video dọc 9:16" }
  ],
  // ti: tỉ lệ thanh (0–100), chỉ để minh hoạ. Số liệu giá là GIỮ CHỖ, thay bằng số thật có nguồn.
  compare: [
    { name: "Nền tảng X", price: "3.000.000đ/tháng", note: "Trả theo credit, mua theo gói", ti: 100 },
    { name: "Nền tảng Y", price: "2.600.000đ/tháng", note: "Trả theo credit, mua theo gói", ti: 87 },
    { name: "Skyloom", price: "299.000đ/tháng", note: "Trả theo phần mềm, số video không giới hạn", ti: 10, chinh: true }
  ],
  compareNote: "Số liệu so sánh chỉ minh hoạ. Hãy thay bằng số có nguồn và ngày tham chiếu trước khi đăng.",
  models: {
    a: { label: "Mô hình A", desc: "Hình đẹp, clip 8 giây có âm thanh, tải bản 1080p." },
    b: { label: "Mô hình B", desc: "Nhanh, nhẹ máy, chạy đều hàng trăm clip mỗi ngày." }
  },
  // Giá theo kỳ hạn (nghìn đồng / tháng). Điều chỉnh tuỳ ý.
  periods: [
    { id: 1, label: "1 tháng", off: "" },
    { id: 6, label: "6 tháng", off: "−43%" },
    { id: 12, label: "1 năm", off: "−57%" }
  ],
  plans: [
    { id: "pro", name: "Pro", price: { 1: 299, 6: 171, 12: 129 },
      bullets: [[1, "Tối đa 8 luồng song song"], [1, "Tải video không watermark"], [1, "Chỉnh sửa, cắt ghép trong ứng dụng"], [1, "Cập nhật trong thời gian còn hạn"], [1, "Nâng video lên 1080p"], [0, "Công cụ phân tích video xu hướng"]] },
    { id: "unlimited", name: "Unlimited", hot: true, price: { 1: 499, 6: 285, 12: 215 },
      bullets: [[1, "Không giới hạn luồng"], [1, "Mọi thứ của gói Pro"], [1, "Công cụ phân tích video xu hướng"], [1, "Tạo ảnh theo tổng hạn mức tài khoản"], [1, "Hỗ trợ ưu tiên"], [1, "Nhận yêu cầu tính năng riêng"]] }
  ],
  comboOff: "20%",
  footer: {
    cols: [
      ["Sản phẩm", [["Bản demo", "#tinh-nang"], ["Chi tiết", "#"], ["Bảng giá", "#chi-phi"], ["Tải về", "#"]]],
      ["Hỗ trợ", [["Hỏi đáp", "#"], ["Hướng dẫn cài đặt", "#"], ["Yêu cầu máy", "#"], ["Liên hệ", "#"]]],
      ["Tài khoản", [["Đăng nhập", "#"], ["Đăng ký", "#"], ["Quên mật khẩu", "#"]]]
    ],
    legal: "Công cụ tự động hoá thao tác trên tài khoản của chính người dùng với các dịch vụ AI. Người dùng tự chịu trách nhiệm tuân thủ điều khoản của từng dịch vụ.",
    company: "[Tên công ty] · [Mã số thuế] · [Địa chỉ] · [Điện thoại] · [Email]"
  }
};

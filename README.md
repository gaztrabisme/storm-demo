# Bản đồ bão (demo)

Trang thử nghiệm của CLB Thiên văn USAC: phát lại bão Yagi (2024) như một bản tin dự báo, để thử xem người dùng có hiểu ngay nơi mình ở có bị ảnh hưởng không, khi nào, và cần làm gì.

Đây không phải dự báo thật. Mọi số liệu là của cơn bão đã qua.

## Chạy thử

```bash
npm install
npm run dev
```

Mở `http://localhost:5195/`. Thêm `?test=1` để bật nút xuất dữ liệu thử nghiệm.

## Kiểm tra

- `npm test`: kiểm tra đơn vị (cần file IBTrACS gốc ở `../experiments/d1_track/work/` cho phần so dữ liệu).
- `npm run uat`: kiểm tra chấp nhận bằng trình duyệt, khi `npm run dev` đang chạy.

## Nguồn

- Đường đi bão: IBTrACS v04r01 (NOAA).
- Đường bờ biển: Natural Earth.
- Tọa độ tỉnh: © những người đóng góp OpenStreetMap.
- Nội dung về cấp gió, an toàn khi có bão và vệ tinh GK-2A: xem `SOURCES.md`.
- Usui-chan, linh vật của CLB Thiên văn USAC.

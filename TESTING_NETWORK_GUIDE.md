# Hướng dẫn Chạy Thử và Cấu hình Mạng (IP) cho WebUI

Hệ thống FNet WebUI được cấu hình để có thể dễ dàng chạy trỏ đến backend nằm trên một máy khác trong mạng LAN, hoặc cho phép các thiết bị khác (như điện thoại, máy tính bảng) truy cập vào máy đang code để test.

Dưới đây là 2 trường hợp cấu hình mạng phổ biến:

## 1. Môi trường Phát triển / Thử nghiệm (chạy `npm run dev`)

Đây là lúc bạn đang viết code, chưa build ra file tĩnh.

### a. Trỏ API tới một máy chủ Backend (Server.exe) nằm trên máy tính khác
Mặc định WebUI sẽ gọi API về `127.0.0.1:18099`. Nếu Backend đang chạy ở máy tính khác (ví dụ máy đó có IP là `192.168.1.100`), bạn hãy sửa file cấu hình proxy của Vite.

1. Mở file `fnet-web/vite.config.ts`.
2. Sửa thông số `target` thành IP của máy chứa Backend:
   ```ts
   export default defineConfig({
     server: {
       proxy: {
         '/api': {
           target: 'http://192.168.1.100:18099', // Đổi IP này
           changeOrigin: true,
           rewrite: (path) => path.replace(/^\/api/, ''),
         },
       },
     },
   })
   ```
3. Lưu lại và restart `npm run dev`.

### b. Cho phép điện thoại / máy tính khác truy cập vào WebUI của bạn
Mặc định Vite chỉ mở cổng `localhost` (chỉ máy bạn xem được). Để điện thoại/tablet có thể xem được giao diện bạn đang code, bạn cần bảo Vite lắng nghe trên toàn bộ IP của máy (Host 0.0.0.0).

Thay vì chạy lệnh dev thông thường, bạn chạy lệnh sau:
```bash
npm run dev -- --host 0.0.0.0
```
Terminal sẽ in ra một địa chỉ IP LAN (ví dụ: `http://192.168.x.x:5173/`). Bạn lấy điện thoại truy cập vào địa chỉ này chung mạng Wifi là có thể thao tác được bình thường.

---

## 2. Môi trường Chạy thật (Môi trường Production sau khi Build)

Đây là lúc bạn đã chạy xong `npm run build` để đóng gói ra file HTML/JS tĩnh đưa lên máy chủ hoặc Nginx/IIS. Lúc này Vite Proxy không còn tác dụng, ứng dụng sẽ gọi API trực tiếp.

Để đổi IP Backend lúc này, không cần sửa trong file `.ts` nữa, hãy làm theo cách sau:

1. Tại thư mục gốc `fnet-web/`, tạo một file tên là `.env.production` (nếu chưa có).
2. Viết nội dung khai báo địa chỉ của Backend vào đó. Ví dụ:
   ```env
   VITE_API_BASE_URL=http://192.168.1.200:18099
   ```
3. Chạy lệnh build:
   ```bash
   npm run build
   ```
4. Code WebUI sau khi build xong sẽ tự động đọc biến `VITE_API_BASE_URL` này để trỏ lệnh gọi API (`src/api/client.ts`) về đúng địa chỉ mạng LAN của máy chủ thay vì localhost.

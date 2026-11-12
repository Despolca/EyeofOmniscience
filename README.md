# Toàn Thị Chi Nhãn (Eye of Omniscience) v1.4.4

"Toàn Thị Chi Nhãn" là tiện ích mở rộng (extension) được thiết kế riêng cho SillyTavern. Công cụ này xếp chồng một lớp meta-setting lên trên Character Card gốc, giúp bạn thoát khỏi khuôn khổ định sẵn của thẻ nhân vật để điều chỉnh thế giới quan theo thời gian thực, chỉnh sửa thiết lập nhân vật, giám sát trạng thái của nhân vật chỉ định, ban hành chỉ thị tối cao và dùng prompt để định hướng AI tạo các thiết lập có cấu trúc.

**Tuyên bố miễn trừ trách nhiệm**: Extension này về bản chất là một bộ logic ràng buộc bằng prompt, mức độ ổn định của hiệu quả phụ thuộc rất lớn vào khả năng tuân thủ chỉ thị của model nền tảng. Model càng biết nghe lời thì việc thực thi thiết lập càng chuẩn xác.

## Tính năng cốt lõi

### 1. Sửa đổi thiết lập (Setting Override)

Ghi đè thiết lập của card gốc thông qua việc định nghĩa các mục "World Setting" và "Character Setting". Hỗ trợ quản lý phân cấp (cơ chế hệ thống, harem, NSFW, nhịp độ tường thuật...), AI sẽ ưu tiên phản hồi các chỉ thị cấp cao này trước.

- **Lưu thành tùy chỉnh**: Phía bên phải mỗi mục World Setting đều có nút bookmark. Nhấp vào để lưu mục đó cùng toàn bộ mục con bên dưới thành mục tùy chỉnh để tái sử dụng sau này. Trước khi lưu sẽ hiện cửa sổ đặt tên, bạn có thể tự do đặt tên theo ý muốn.
- **Cảnh báo trùng lặp khi import**: Khi nội dung import bị trùng với nội dung đã lưu từ trước, hệ thống sẽ đưa ra cảnh báo để bạn chọn thêm tiếp, thay thế hoặc hủy bỏ, tránh việc trực tiếp ghi đè làm mất dữ liệu cũ. Các mục được import cũng có thể đổi tên từng mục trước khi lưu thành tùy chỉnh.

### 2. Giám sát thời gian thực (Real-time Monitor)

Thêm nhân vật vào danh sách giám sát, câu trả lời của AI sẽ đính kèm biểu mẫu trạng thái của nhân vật đó (Vị trí / Hành vi / Ngoại hình / Trang phục / Trạng thái / Tâm ý).

- **Ghi chép chân thực**: Bao quát toàn bộ tiến trình từ những khoảnh khắc tỏa sáng cho đến sinh hoạt thường nhật vụn vặt.
- **Tách biệt góc nhìn**: Chỉ khi nhân vật xuất hiện trực tiếp trong nội dung chat chính, nội dung giám sát mới được hiển thị đồng bộ dưới góc nhìn của nhân vật; nếu không, phần giám sát chỉ lưu lại trong hồ sơ chạy ngầm.
- **Lưu ý**: Việc không nhìn thấy khối giám sát trong nội dung chat chính là do tác dụng của Regex ẩn đi chứ không phải AI không sinh ra, bạn hoàn toàn có thể vào trang "Hồ sơ" để xem toàn bộ lịch sử ghi chép.

### 3. Chỉ thị tối cao (Supreme Directive)

Ban hành chỉ thị cụ thể cho nhân vật. AI sẽ tự động bù đắp toàn bộ logic thực thi ở giữa. Nếu mục tiêu không nằm trong góc nhìn hiện tại, quá trình thực thi sẽ chỉ xuất hiện trong hồ sơ ngầm, không gây ngắt quãng mạch hội thoại hiện tại một cách đột ngột.

### 4. Tạo thiết lập tự động (Setting Generator)

Nhấp vào biểu tượng cây bút ở góc trên bên phải trang "Thiết lập" để vào trang tạo thiết lập. Viết ra yêu cầu thiết lập bạn muốn, điền tên, thể loại, phạm vi, NSFW, state machine, rồi nhấn "Gửi" — đoạn nội dung này sẽ được nối vào thanh nhập chat, nhấn Enter để gửi đi. AI sẽ tạm dừng việc sáng tác nội dung dở dang và chỉ tập trung xuất ra một bản thiết lập hoàn chỉnh theo quy trình 8 bước tích hợp sẵn.

- **Chỉ quản lý lượt này**: Ở lượt này, AI không viết văn cảnh chính, không đẩy cốt truyện, chỉ xuất thiết lập và đề xuất chỉnh sửa.
- **Kết quả dùng được ngay**: Đầu ra là một đoạn YAML kèm thẻ tag. Sao chép rồi dán thẳng vào ô "Nội dung" ở trang "Thiết lập", hệ thống sẽ tự động bóc tách thành các mục dạng cây để lưu trữ, đồng thời lưu từng mục vào danh sách tùy chỉnh mà không cần bạn phải gõ thụt lề thủ công.
- **Hiện tại chỉ hỗ trợ World Setting**: Mục Character Setting trong menu thả xuống đang bị làm mờ, tạm thời chưa chọn được.

---

## Cài đặt và cập nhật

**Yêu cầu cài đặt**: SillyTavern 1.18.0 (các phiên bản khác chưa qua kiểm thử); không cần cài đặt extension tiền đề "Tavern Assistant" (酒馆助手).

### Cách thức cài đặt (chọn 1 trong 2)

1. **Khuyên dùng (qua giao diện Extension)**: Điền trực tiếp địa chỉ kho lưu trữ GitHub vào ô nhập trên trang Extension của SillyTavern rồi nhấn cài đặt. Sau khi cài, bạn có thể nhấn trực tiếp nút "Update" trên bảng điều khiển để cập nhật.
2. **Giải nén file ZIP**: Tải repository về, giải nén và đổi tên thư mục thành `SillyTavern-Eye-of-Omniscience` (file nén tải từ GitHub thường có hậu tố `-main`, hãy xóa nó đi), rồi đặt vào thư mục `extensions/`.

    > Bên trong thư mục phải chứa trực tiếp tệp `manifest.json`, không được lồng thêm một lớp thư mục nào khác.

### Các bước bắt buộc sau khi cài đặt

1. Làm mới lại trang SillyTavern (<kbd>Ctrl</kbd>+<kbd>F5</kbd>).
2. Tìm mục "**Toàn Thị Chi Nhãn · Cài đặt & Cập nhật**" trong trang Extension, nhấn vào "**Cài đặt mục đã chọn**" (thao tác này sẽ ghi các quy tắc vào Worldbook).
3. Sau khi cài đặt, Worldbook sẽ tự động được thiết lập kích hoạt toàn cục (Global Enable).

---

## Chi tiết các node chức năng

Nhấn vào biểu tượng con mắt trên màn hình để mở ra 6 node:

- **Ghi chép**: Quản lý danh sách giám sát. Mỗi danh sách là một entry độc lập.
  - Các icon phía sau tên:
    - Con mắt (Xem hồ sơ)
    - Cây bút (Đổi tên)
    - Dấu X (Xóa khỏi danh sách)
- **Hồ sơ**: Xem lại lịch sử giám sát của nhân vật theo từng tầng tin nhắn. Hỗ trợ ghim nhân vật lên đầu, nhấp đúp vào số trang để chuyển nhanh, hỗ trợ lật trang "Tầng trước / Tầng sau".
- **Thiết lập**: Tạo các entry "World Setting" và "Character Setting".
  - **Khung thông thường**: Điền trực tiếp tiêu đề lớn và nội dung, nhấn "Lưu" hoặc "Thêm vào".
  - **Khung phức hợp (tùy chọn)**: Dùng nút "+ Cùng cấp" hoặc "+ Cấp dưới" để xây dựng cấu trúc lồng nhau.
  - **Dán toàn bộ**: Dán trực tiếp thiết lập do AI tạo ra (dạng có khối code) vào ô "Nội dung", hệ thống sẽ dựa vào tag và thụt lề để tự động tách thành nhiều tầng entry ghi vào card hiện tại; nếu dán một câu thông thường thì vẫn áp dụng logic entry đơn lẻ cũ.
  - **Cây bút góc trên bên phải**: Chuyển đến trang "Tạo thiết lập".
- **Chỉ thị**: Soạn thảo và gửi chỉ thị (khen thưởng, trừng phạt, cải tạo, tẩy não).
- **Cài đặt**: Cấu hình tùy chọn extension.
- **Hướng dẫn**: Tài liệu hướng dẫn sử dụng chi tiết được tích hợp sẵn.

### Mẹo cốt lõi

- **Lưu và Thêm vào**: "Lưu" chỉ lưu vào danh sách entry tùy chỉnh để tái sử dụng sau này (chưa có hiệu lực); chỉ khi chọn "Thêm vào" thì nội dung mới thực sự được ghi vào Worldbook.
- **Kiểm soát kích hoạt**: Bảng điều khiển extension chỉ phụ trách tạo và quản lý entry. Bạn cần tích chọn entry trong **bảng Worldbook mặc định của SillyTavern** thì entry đó mới được đưa vào quá trình inject.
- **Đánh thức AI mạnh mẽ**: Nhấp vào biểu tượng "Gửi" nhỏ bên phải danh sách kích hoạt để nối nội dung entry vào thanh nhập chat, sau đó cần nhấn Enter thủ công để gửi đi.
- **Tăng cường đầu vào (Input Enhancement)**: Chèn một thẻ đánh dấu ẩn vào trước mỗi lượt phản hồi. **Lưu ý**: Bạn sẽ không thấy thẻ này trong khung soạn thảo cũng như trong lịch sử chat, đây là thiết kế có chủ đích.

### Giải thích trang Cài đặt

| Nhóm | Công tắc | Diễn giải |
| :--- | :--- | :--- |
| — | Toàn Thị Chi Nhãn | Công tắc tổng. Khi tắt, các entry sẽ chuyển sang kích hoạt bằng từ khóa, không còn inject thường trực nữa |
| Công tắc chức năng | Giám sát / Thiết lập / Chỉ thị | Tắt mục nào thì node tương ứng sẽ bị mờ không thể bấm, các entry thuộc quyền quản lý của node đó cũng ngừng inject thường trực |
| Tăng cường tính năng | Chế độ cường lực (Power Mode) | Chuyển đổi tổng thể giữa vị trí "Sau định nghĩa nhân vật" và "Cuối cùng của đối thoại · Depth 0", là phương án ưu tiên hàng đầu để khắc phục lỗi "thiết lập không có hiệu lực" |
| Tăng cường tính năng | Tăng cường đầu vào (Input Enhancement) | Thêm thẻ đánh dấu ẩn vào phần đầu tiên của nội dung gửi cho AI |
| Hiển thị | Tách rời menu | Bảng điều khiển tách khỏi bóng nổi (floating button), có thể kéo thả tự do |
| Hiển thị | Tối giản hiệu ứng | Tăng tốc hiệu ứng động của menu lục giác |

---

## Dữ liệu và cập nhật

- **Lưu trữ dữ liệu**:
  - **Entry Worldbook**: Gồm 5 quy tắc cố định (Toàn Thị Chi Nhãn, Sửa đổi thiết lập, Giám sát thời gian thực, Chỉ thị tối cao, Tạo thiết lập). Các entry tùy chỉnh sẽ mang tiền tố `Thiết lập thế giới-`, `Thiết lập nhân vật-`, `Đối tượng giám sát-`.
  - **Lưu trữ cục bộ**: Cấu hình bảng điều khiển và các mục cài đặt được lưu trong `localStorage` của trình duyệt (bắt đầu bằng tiền tố `dg_eye_`).
- **Quản lý đa Card**: Dữ liệu được lưu trữ độc lập theo từng Character Card. Sau khi đổi thẻ nhân vật, nếu thấy thiết lập "dường như biến mất" thì đừng hoảng loạn, chỉ cần đổi lại card ban đầu là dữ liệu vẫn còn nguyên vẹn.
- **Cách thức cập nhật**: Sử dụng nút Update trên bảng extension để cập nhật rồi tải lại trang. Nếu quy tắc bị thay đổi hoặc nội dung/cấu hình bị chỉnh sửa, danh sách cài đặt sẽ báo "Lỗi cấu hình", bạn có thể đối chiếu rồi chọn cập nhật thủ công lên phiên bản chính thức mới nhất.

## Câu hỏi thường gặp (FAQ)

1. **Không thấy bóng nổi (floating button)?** Kiểm tra xem script "**Tavern Assistant**" phiên bản cũ có còn đang chạy hay không. Khi xảy ra xung đột, extension này sẽ **nhường quyền và không khởi động**, vui lòng tắt script cũ trước rồi tải lại trang.
2. **Thiết lập không có hiệu lực?** Hãy lần lượt kiểm tra: Worldbook đã bật Global Enable chưa, công tắc tổng ở trang Cài đặt đã bật chưa, entry đó đã được tích chọn trong bảng Worldbook của SillyTavern chưa, và 5 entry quy tắc cố định đã được bật hay chưa.
3. **4 bước gỡ cài đặt sạch sẽ**:
   1. Xóa thư mục `extensions/SillyTavern-Eye-of-Omniscience`.
   2. Xóa 5 quy tắc cố định trong Worldbook, cùng tất cả các entry tùy chỉnh có chứa tiền tố liên quan.
   3. Vào bảng Regex xóa mục "Toàn Thị Chi Nhãn - Ẩn nội dung giám sát".
   4. Mở Console trình duyệt thực thi lệnh dọn dẹp các dữ liệu có tiền tố `dg_eye_` trong `localStorage`.

## Giới hạn đã biết

- Tin nhắn dạng hình ảnh sẽ không kích hoạt Tăng cường đầu vào; trong chế độ Text Completion, hệ thống định vị tin nhắn người dùng dựa vào văn bản gốc, nếu preset có can thiệp xử lý bổ sung thì thẻ đánh dấu có thể sẽ rơi vào vị trí đầu tiên của toàn bộ tin nhắn.
- Các model năng lực yếu có thể cho ra kết quả không trọn vẹn hoặc chỉ thực hiện được một nửa chỉ thị; các entry thiết lập inject thường trực vào ngữ cảnh, viết càng nhiều thì lượng Token tiêu thụ càng lớn.

---

## Nhật ký cập nhật (Changelog)

### v1.4.4

**Sửa lỗi**

- Sửa lỗi mục World Setting mặc định thuộc phân loại "Khác" bị dùng sai tiêu đề lớn khi ghi vào Worldbook (hiện tại chỉ ảnh hưởng đến World Setting "Renkemon").

**Tính năng mới**

- Bổ sung cơ chế liên kết đồng bộ giữa nội dung xuất ra của tính năng Tăng cường đầu vào, kiểu dáng công tắc với Công tắc tổng, Công tắc giám sát và Công tắc thiết lập.

**Điều chỉnh**

- Tối ưu hóa vị trí chèn thẻ đánh dấu của tính năng Tăng cường đầu vào.

### v1.4.3

**Sửa lỗi**

- Sửa lỗi trang World Setting không thể nhấn "+ Cùng cấp" để tạo tiêu đề entry thứ hai.
- Sửa lỗi World Setting khi import không thể lưu thành preset tùy chỉnh.
- Sửa lỗi nội dung tùy chỉnh bị lưu trùng lặp.
- Sửa lỗi cửa sổ pop-up hiển thị quá cao khi nhấn giữ để xem preset tùy chỉnh.
- Sửa các lỗi tồn đọng đã biết khác.

**Tính năng mới**

- Thêm nút bookmark bên phải entry World Setting, nhấn vào để lưu World Setting đang tải thành World Setting tùy chỉnh.
- Thêm pop-up xác nhận đặt tên, cho phép chỉnh sửa tiêu đề lớn.
- Thêm cơ chế kiểm tra kernel, tự động đánh số thứ tự đối với các nội dung tùy chỉnh trùng tên nhưng khác nội dung.
- Thêm công tắc "Ghi đè thiết lập", kiểm soát việc có cho phép ghi đè toàn bộ khối khi import preset hay không.
- Bổ sung World Setting mặc định "Renkemon".

**Điều chỉnh**

- Tinh chỉnh câu chữ trong một số mô tả giao diện.
- Tái cấu trúc logic đặt tên World Setting, tối ưu hóa phương thức đặt tên mặc định.
- Tối ưu hóa logic import World Setting, sau khi import thành công sẽ tự động lưu thành preset tùy chỉnh và tải ngay vào Character Card hiện tại.

### v1.4.2

**Sửa lỗi**

- Sửa lỗi entry đối tượng giám sát bị thiếu thẻ bọc (tag).
- Sửa một số lỗi chính tả và mô tả sai lệch đã biết.

**Tính năng mới**

- Tính năng Tạo thiết lập bổ sung tùy chọn "Thiết lập NSFW", chia làm 4 mức độ.

**Điều chỉnh**

- Workflow tạo thiết lập được điều chỉnh từ 7 bước lên 8 bước, bổ sung bước đánh giá mức độ NSFW và phân tích tác phẩm tham khảo.
- Chỉ thị tối cao không còn inject thường trực vào ngữ cảnh nữa, đổi sang kích hoạt bằng Trigger Word tương tự như tính năng Tạo thiết lập.
- Đồng bộ hóa Trigger Word của Tạo thiết lập và Chỉ thị tối cao thành dạng nối bằng dấu gạch dưới.
- Làm rõ quy tắc: Giám sát thời gian thực sẽ không xuất biểu mẫu giám sát khi danh sách giám sát đang trống.

### v1.4.1

**Sửa lỗi**

- Sửa lỗi danh sách cài đặt báo nhầm "Lỗi cấu hình" trong một số trường hợp cụ thể.

**Điều chỉnh**

- Vẽ lại biểu tượng bóng nổi (floating button), chuyển từ ảnh nhãn cầu tả thực 3 trạng thái sang ảnh mắt mèo con ngươi dọc tối giản.

### v1.4.0

**Tính năng mới**

- **Tạo thiết lập**: Thêm lối vào biểu tượng cây bút ở góc trên bên phải trang thiết lập. Nhập yêu cầu, điền tên (có thể để trống), chọn loại, phạm vi và state machine rồi nhấn "Gửi", AI sẽ tạm dừng việc sáng tác hiện tại và chỉ tạo ra thiết lập cùng ý kiến đề xuất theo quy trình 7 bước tích hợp. Đoạn YAML tạo ra khi sao chép và dán lại vào ô "Nội dung" của trang thiết lập sẽ tự động được bóc tách thành các entry phân tầng.
- Trang thiết lập hỗ trợ dán toàn bộ: Nếu dán văn bản thiết lập có chứa khối code vào ô "Nội dung", hệ thống sẽ căn cứ vào tag và thụt lề để tự động tách tầng; nếu dán văn bản thông thường thì vẫn giữ nguyên logic xử lý entry đơn lẻ như trước.

**Sửa lỗi**

- Sửa lỗi sau khi cài đặt lại Worldbook, trạng thái tích chọn của hai tùy chọn chống đệ quy (prevent recursion) trên quy tắc mới bị mất (trước đây khi tạo entry mới mặc định là không tích chọn).
- Sửa lỗi khi đang bật "Chế độ cường lực" mà cài bổ sung quy tắc thì quy tắc mới bị rơi nhầm vào vị trí "Sau định nghĩa nhân vật", dẫn đến lệch vị trí so với các quy tắc còn lại đang nằm ở "Cuối cùng của đối thoại · Depth 0". Hiện tại việc cài bổ sung quy tắc đã tuân thủ chính xác trạng thái bật/tắt của "Chế độ cường lực".
- Sửa lỗi sau khi Worldbook bị xóa và tạo lại, sách mới không tự động được đưa vào danh sách kích hoạt toàn cục (Global Enable).
- Sửa lỗi khi bảng điều khiển ghi ngược dữ liệu về Worldbook, tính năng "Kích hoạt có chọn lọc" (Selective trigger) của các entry không thường trực bị bật nhầm.

**Cải tiến**

- Nâng cấp phạm vi đối chiếu của danh sách cài đặt: Hiện bao quát cả nội dung chính, vị trí và depth chèn, thứ tự entry, thứ tự hiển thị trên bảng điều khiển, trạng thái tích chọn của 2 mục chống đệ quy, công tắc thường trực và Trigger Word. Chỉ cần một trong số các mục này không khớp là sẽ báo "Lỗi cấu hình", không còn giới hạn ở việc chỉ so sánh nội dung văn bản.
- Tối ưu hóa cơ chế cập nhật: Khi nhấn cập nhật chỉ sửa chữa đúng các entry không khớp, đảm bảo các entry còn lại không bị suy chuyển dù chỉ một byte; trước khi ghi sẽ kiểm tra xem có làm ảnh hưởng đến entry khác hay không, nếu có sẽ lập tức dừng lại; sau khi ghi sẽ đọc lại để đối soát, nếu không khớp sẽ báo lỗi.
- Thống nhất thông báo sau khi hoàn tất cập nhật thành "Đã cập nhật".

### v1.3.0

Phát hành lần đầu tiên trên GitHub.

---

## Cấu trúc thư mục và Giấy phép

```
SillyTavern-Eye-of-Omniscience/
├── manifest.json  Thông tin extension
├── index.js       File logic chính
├── style.css      File định dạng giao diện
├── README.md      Tài liệu hướng dẫn
└── LICENSE        Giấy phép bản quyền
```

Extension này sử dụng giấy phép phần mềm mã nguồn mở MIT, xem toàn bộ điều khoản chi tiết tại tệp `LICENSE` ở thư mục gốc của repository.
# Plan: Tab Latency báo "offline" sai — hợp nhất nguồn "online" với Overview/Machines

Trạng thái: **ĐÃ QUA 3 LƯỢT REVIEWER + USER PHÊ DUYỆT (Phương án B) 2026-07-13. ĐANG
IMPLEMENT.**
Ngày: 2026-07-13
Repo: shadcn-admin (dashboard). Fix **chỉ frontend**, không đụng server/DB.
Khuyến nghị chốt: **Phương án B**.

Lịch sử review (mỗi lượt đọc code thật để kiểm chứng, đã hấp thụ):
- L1 (correctness): sửa trích dẫn line `/api/machines`; thêm bằng chứng `LiveUsersTable`;
  yêu cầu test cấp component.
- L2 (code/kiến trúc): đặc tả hook `useNodeLiveState({poll})` expose `liveQuery` giữ nguyên
  `isFetching`; staleTime 30s + owner refetch; chi tiết dựng test (QueryClientProvider +
  mock 5 fetch) + fixture infra; key helper.
- L3 (cross-model, Fable): **phát hiện lỗi polling-ownership** — Latency là leaf tab đứng
  một mình, phải `poll: true` nếu không cột Online đóng băng (bug tái sinh); viết lại ghi
  chú dedupe mục 7; chuẩn hóa badge = FL-1.

---

## 1. Triệu chứng (bug do user báo)

- Panel **"Thiết bị người dùng online"** (trang Overview) hiển thị `votam-pc` (100.64.0.24)
  = **Connected**, DERP `vpn4-vn`, latency `209.8ms`, Last seen 7:17:26 PM.
- Cùng lúc, tab **Latency** (Client) hiển thị chính `votam-pc` = **offline**, cột "DERP đang
  dùng" và "Latency đến DERP" đều là `—`.
- Máy đã online > 1 phút nhưng tab Latency vẫn offline → **hai màn hình mâu thuẫn nhau về
  cùng một node**.

## 2. Root cause (đã truy tới code)

Hai màn hình dùng **hai định nghĩa "online" khác nhau**:

| | Panel "Thiết bị người dùng online" (Overview) | Tab **Latency** |
|---|---|---|
| File | `src/features/overview/index.tsx` (`useRealNodes` → `ClientDevicesTable`) | `src/features/latency/index.tsx` (`Latency`) |
| Nguồn online | `/api/devices/live` (đã **hợp nhất**) | `/api/machines` (cờ **thô**) |
| Công thức | `liveByNodeKey.get(nodeKey)?.online ?? n.online ?? false` | `!!n.online` |

- `/api/devices/live` (`server/src/routes/devices.ts`) tính online qua
  `resolveDeviceLiveState()` (`server/src/lib/device-registry.ts:504`):

  ```
  online = reporting(telemetry tươi <60s) || headscaleOnline === true
  ```

  Tức **OR** của hai tín hiệu độc lập: telemetry client tự báo (home-derp ~3s/lần) **hoặc**
  headscale còn giữ map-poll. Đây là nguồn "thật".

- Tab Latency chỉ đọc cờ **thô** `n.online` từ `/api/machines`. Handler
  `/api/machines` (`server/src/routes/headscale.ts:86-96`) chỉ **passthrough nguyên khối**
  `return { configured: true, nodes: d.nodes ?? [] }` — trả thẳng object node của headscale
  (kèm field `online` chưa qua xử lý), **không** có bước map nào qua `resolveDeviceLiveState`,
  **không** ngó telemetry. (Lưu ý: dòng `headscale.ts:215` `online: n.online` là của handler
  KHÁC — `/api/routes` — không liên quan bug này.)

**Ca votam-pc**: telemetry đang tươi (chính vì thế panel Overview có latency 209.8ms +
DERP vpn4-vn), nhưng cờ map-poll của headscale lúc đó = false (headscale online hay
flap/trễ). Vậy:
- Overview: `resolveDeviceLiveState` = `reporting(true) || false` = **online** ✅ (đúng)
- Latency: `!!n.online` = **false** = offline ❌ (sai)

Đây đúng là ca đã có unit-test ở server: `device-registry.test.ts:254`
*"headscale offline + telemetry tươi -> online"*. Overview/Machines đã chuyển sang nguồn
hợp nhất (`useRealNodes` đọc `/api/devices/live`; comment `overview/index.tsx:126-129`
ghi rõ "Overview và Machines cùng đọc đúng endpoint này nên hai trang luôn khớp"), **nhưng
tab Latency bị bỏ sót — vẫn dùng cờ thô.**

Hệ quả phụ: vì cột "DERP đang dùng" và "Latency" trong tab Latency đều bị gate bởi
`r.online` (`latency/index.tsx:98-112`), khi online sai = false thì hai cột này cũng bị
blank `—` theo → khớp đúng ảnh chụp.

**Bằng chứng bổ trợ (Phương án B không phải lý thuyết)**: trang "Machines → Người dùng"
(`src/features/machines/index.tsx`, `LiveUsersTable`, ~dòng 744+) **đã** tự triển khai đúng
pattern hợp nhất này trong production — lấy primary từ `/api/devices/live` rồi merge thêm
node headscale thô (client build tiêu chuẩn chưa có device_identity) với đúng fallback
`?? false`. Nghĩa là cách tiếp cận của plan đã được chứng minh chạy tốt ở nơi khác, chỉ tab
Latency bị bỏ sót. (Ghi chú: `DevicesTable({ variant: 'users' })` cùng file ~dòng 623 cũng
dùng `n.online` thô y hệt lỗi này, nhưng hiện **không được render ở đâu** trong UI —
`machines-section.tsx` chỉ dùng `variant='derp'` — nên là code chết, KHÔNG nằm trong phạm vi
sửa; nêu ra để tránh hiểu nhầm "đã quét sạch mọi chỗ dùng `n.online` thô".)

## 3. Phạm vi sửa

- **Trong phạm vi**: đưa cột "Online" của tab Latency về **cùng nguồn hợp nhất** với
  Overview/Machines (`/api/devices/live`), để 3 màn hình luôn nhất quán.
- **Ngoài phạm vi (ghi nhận, không sửa trong PR này)**:
  - Cột "DERP đang dùng" của tab Latency vẫn suy từ heuristic latency-pairs
    (`clientDerpMap` trong `latency/index.tsx`), khác với Overview đã chuyển sang telemetry
    home-derp (`overview/index.tsx:367-375`, vì pairs "có thể lấy nhầm relay của peer").
    Sau khi fix online, votam-pc sẽ hiện online + DERP/latency theo heuristic cũ — chấp
    nhận được (đúng như ghi chú "Cột DERP hiển thị sau khi Feature L" ở cuối tab). Thống
    nhất cột DERP sang telemetry là **follow-up riêng**, không gộp vào fix này để giữ diff
    nhỏ, dễ review.
  - Không đổi bất kỳ logic server/DB nào — endpoint hợp nhất đã tồn tại và đã có unit-test.
- **Ghi nợ / follow-up cụ thể (mở ticket riêng, KHÔNG quên):**
  - `FL-1`: Latency hiển thị badge tri-state "Không báo cáo" (khi `online && !reporting`)
    giống Overview — sau fix này Latency đã đúng online/offline nhưng chưa phân biệt
    "reporter hỏng". Không phải bug mới (cả 2 trang vẫn nói "online" nhất quán).
  - `FL-2`: thống nhất cột "DERP đang dùng" của Latency sang telemetry home-derp (như
    Overview) thay cho heuristic latency-pairs.

## 4. Phương án (chọn 1)

### Phương án B — Trích hook dùng chung (KHUYẾN NGHỊ)

Tạo **một nguồn "online" duy nhất ở frontend** để không tái diễn drift (bug này chính là
hệ quả của việc có 2 bản copy logic online). Cụ thể:

1. Tạo `src/features/headscale/use-live-nodes.ts` export hook
   `useNodeLiveState({ poll }: { poll?: boolean } = {})`:
   - Query `['devices','live']` bằng `fetchLiveDevices` (đã có sẵn trong `hs-api.ts:301`),
     với `staleTime: 30_000` và `refetchInterval: poll ? 30_000 : undefined` — **khớp y
     hệt** query `liveDevices` đang inline trong `useRealNodes` (`overview/index.tsx:130-135`)
     để không đổi hành vi polling.
   - Trả `{ liveByNodeKey, isNodeOnline, isNodeReporting, liveQuery }` — **phải expose luôn
     query object** (hoặc tối thiểu `isFetching`/`isPending` của nó). Lý do BẮT BUỘC:
     `useRealNodes` hiện gộp `liveDevices.isFetching` vào phép OR `isFetching`
     (`overview/index.tsx:169-175`); nếu hook nuốt mất trạng thái này, người refactor rất dễ
     "xoá cho sạch compile" điều kiện đó → chấm "đang cập nhật" trên `StatMachines`/
     `StatClientDerp` ngừng phản ánh refetch nền của `/api/devices/live` (regression UI âm
     thầm, TypeScript KHÔNG bắt). Hook expose `liveQuery` để `useRealNodes` giữ NGUYÊN công
     thức `isFetching` cũ.
   - Ngữ nghĩa online/reporting khớp **nguyên si** `overview/index.tsx:150-155`:
     - `isNodeOnline(n) = liveByNodeKey.get(nodeKeyNorm(n))?.online ?? n.online ?? false`
     - `isNodeReporting(n) = liveByNodeKey.get(nodeKeyNorm(n))?.reporting ?? true`
   - **Gia cố join theo bài học [nodeKey format asymmetry]**: chuẩn hoá nodeKey 2 phía về
     lowercase khi build map và khi lookup (device_identity lưu chuẩn hoá; `/api/machines`
     trả thô). Hiện Overview join thô-thô và *tình cờ* khớp vì headscale trả lowercase; thêm
     `.toLowerCase()` cả hai phía là belt-and-suspenders, không đổi hành vi ca đang chạy.
   - **Export thêm `liveDevicesKeys.all = ['devices','live']`** (key helper tập trung) để
     Latency + Overview + Machines cùng dùng, tránh gõ tay literal sai key ở nơi thứ 4.
2. Refactor `overview/index.tsx` `useRealNodes()` để tiêu thụ hook này (bỏ query
   `liveDevices` inline + 2 hàm `isNodeOnline/isNodeReporting` trùng lặp). Hành vi Overview
   **giữ nguyên**. Chú ý giữ ĐÚNG công thức cũ: `isFetching` (dòng 169-175) CÓ gộp
   `liveDevices.isFetching`, nhưng `isLoading` (dòng 169) **KHÔNG** gộp `liveDevices.isPending`
   — đừng "tiện tay" thêm/bớt khi nối qua `liveQuery`.
3. `latency/index.tsx`:
   - Gọi **`useNodeLiveState({ poll: true })`** — **BẮT BUỘC `poll: true`**. Lý do (điểm mù
     lượt 1-2 bỏ qua): tab Latency là **leaf tab render độc lập** trong `MachinesSection`
     (`machines-section.tsx:139` chỉ render `current.render()` — chỉ leaf active được mount).
     Khi tab Latency mở, **Overview KHÔNG mounted** và `LiveUsersTable` (nhóm khác) cũng
     KHÔNG mounted → **không observer nào khác giữ timer cho `['devices','live']`**. Nếu để
     `poll=false`, query fetch 1 lần lúc mount rồi ĐÓNG BĂNG: votam-pc lên mạng sau đó (cờ
     headscale vẫn false) → cột Online kẹt "offline" vô hạn = **bug gốc tái sinh dạng đóng
     băng**. `poll: true` cho Latency tự own `refetchInterval: 30_000` (khớp dòng UI "Tự làm
     mới 30s"); react-query dedupe theo key + interval per-observer nên không xung đột với ai.
   - Thay `online: !!n.online` → `online: isNodeOnline(n)` khi build `allRows`
     (`latency/index.tsx:199`).
   - Badge tri-state "Không báo cáo" = **FL-1, KHÔNG làm trong PR này** (xem mục 3). PR này
     chỉ sửa đúng/sai của cột Online cho nhất quán.
   - Node hạ tầng (DERP infra) không có trong `/api/devices/live` (endpoint chỉ trả
     `deviceType='client'`) → `isNodeOnline` tự fallback `?? n.online` = đúng cờ headscale
     cho infra. Tab "Hạ tầng / Collector" **không đổi hành vi**.

**Trích pure helper để test được (CI):** tách quyết định thuần
`pickNodeOnline({ live, headscaleOnline })` = `live?.online ?? headscaleOnline ?? false`
(và `pickNodeReporting`) ra hàm thuần trong `use-live-nodes.ts`, hook chỉ ráp map + gọi
helper. Giúp unit-test không cần render browser.

### Phương án A — Vá tối thiểu (fallback nếu muốn diff nhỏ nhất)

Chỉ sửa `latency/index.tsx`: thêm query `['devices','live']` + build `liveByNodeKey` inline
(copy 6 dòng từ Overview) + đổi `online: !!n.online` → công thức hợp nhất. Không đụng
Overview. **CẢNH BÁO: query inline PHẢI có `refetchInterval: 30_000`** — cùng bẫy polling
ownership ở Phương án B mục 4-B-3 (copy query từ Overview `poll:false` sẽ đóng băng cột
Online vì Latency đứng một mình, không observer nào khác giữ timer).

- Ưu: diff cực nhỏ, rủi ro thấp nhất.
- Nhược: thành **bản copy thứ 3** của logic online → drift sẽ tái diễn (đúng loại bug này).

> Khuyến nghị **Phương án B**: đây là bug do trùng lặp định nghĩa; hợp nhất về 1 hook mới
> dứt điểm được cả lớp bug. Nếu reviewer/user ưu tiên rủi ro tối thiểu cho hotfix, hạ xuống
> Phương án A và ghi nợ kỹ thuật "hợp nhất hook".

## 5. Thay đổi file dự kiến (Phương án B)

- **Thêm** `src/features/headscale/use-live-nodes.ts` — hook + 2 pure helper.
- **Thêm** `src/features/headscale/use-live-nodes.test.ts` — unit test pure helper.
- **Sửa** `src/features/overview/index.tsx` — `useRealNodes` dùng hook (bỏ code trùng).
- **Sửa** `src/features/latency/index.tsx` — `online` từ `isNodeOnline(n)`.
- **Không** đổi file server nào.

## 6. Chiến lược test (chạy trên GitHub Actions, KHÔNG build/test local)

Tuân thủ [build-test-before-prod] + [debug-with-ci-testcases]: bug phải được chốt bằng
test tái lập được trên CI trước khi ra thật.

1. **Unit (mới)** `use-live-nodes.test.ts` — test `pickNodeOnline` / `pickNodeReporting`,
   phủ đúng ma trận của `resolveDeviceLiveState` để 2 tầng không lệch:
   - live.online=true, headscaleOnline=false → **true** (ca votam-pc — regression chính).
   - không có live (undefined), headscaleOnline=true → true (fallback infra/chưa backfill).
   - không có live, headscaleOnline=false → false.
   - live.online=false, headscaleOnline=true → **false** (live thắng khi đã có dòng live).
   - `pickNodeReporting`: live.reporting=false + online=true → reporting=false (test VÔ ĐIỀU
     KIỆN — helper tồn tại sẵn trong hook dù badge FL-1 chưa render ở Latency).
   - Join case-insensitive nodeKey: key thô UPPER vs stored lowercase vẫn match.
2. **Test cấp component (mới, BẮT BUỘC)** cho `latency/index.tsx` — vì unit test hàm thuần
   KHÔNG bắt được lỗi wiring (vd quên xóa `!!n.online` cũ, truyền nhầm field). Render
   `Latency` với fixture mô phỏng ĐÚNG ca votam-pc: `/api/machines` trả node `online:false`,
   còn `/api/devices/live` trả cùng nodeKey `online:true`. Assert dòng votam-pc hiện "online"
   (không phải "offline"). **Chi tiết dựng test (đây là test component-tự-gọi-useQuery ĐẦU
   TIÊN trong repo — hiện chưa file test nào bọc `QueryClientProvider`)**:
   - Bọc `<QueryClientProvider>` với `new QueryClient({ defaultOptions: { queries: {
     retry: false } } })` — tránh retry/backoff làm test chậm/flaky.
   - `vi.mock('@/features/headscale/hs-api', ...)` mock **đủ CẢ 5** hàm fetch component gọi:
     `fetchMachines`, `fetchLatency`, `fetchDevices`, `fetchLiveDevices`, và `listDerp`
     (từ `@/features/derp/data/derp-api`). GIỮ NGUYÊN các hàm thuần `derpNameSet`,
     `isDerpNodeV2`, `userName`, `deviceTypeMap` (dùng `importActual`) — nếu mock thiếu,
     component kẹt ở nhánh "Đang tải…"/lỗi (gate `mac.data?.configured && !lat.data?.error`,
     `latency/index.tsx:220`) và không assert được gì.
   - Dùng vitest browser + `vitest-browser-react` (đã có trong devDependencies).
   - **Thêm assertion cho tab "Hạ tầng / Collector"**: 1 fixture node infra (KHÔNG có trong
     `/api/devices/live`) để khóa bằng test claim "infra fallback `n.online`, không đổi hành
     vi" — thay vì chỉ suy luận.
3. **Chạy đủ suite frontend**: `pnpm test` (vitest browser headless) + `pnpm lint` +
   `pnpm format:check` + `pnpm build` — đúng job `install-lint-build` trong
   `.github/workflows/ci.yml`. Backend không đổi nên job "DERP backend" chỉ cần vẫn xanh.
4. **Verify thủ công sau khi CI xanh** (không thay test): mở dashboard, so panel Overview
   vs tab Latency cho votam-pc → cùng trạng thái.

Quy trình: branch → commit → push → `gh pr create` → `gh run watch` → chỉ merge main khi
user xác nhận.

## 7. Rủi ro & rollback

- **Rủi ro**: refactor `useRealNodes` (Phương án B) có thể vô tình đổi hành vi Overview.
  Giảm thiểu: hook trả **đúng** các field cũ, giữ nguyên chữ ký `useRealNodes`; diff Overview
  chỉ là "thay khối inline bằng gọi hook". Suite hiện có + build sẽ bắt lỗi type.
- **Rủi ro nhỏ**: thêm 1 query `/api/devices/live` ở tab Latency → 1 request/30s, không đáng
  kể. **Nguyên tắc polling**: mỗi trang/tab tự own `refetchInterval` cho `['devices','live']`
  của nó (tab Latency, Overview, Machines KHÔNG bao giờ cùng mount — xem 4-B-3). react-query
  dedupe theo key CHỈ khi cùng mount; các route không đồng thời sống được phép tự đặt interval
  riêng cho cùng key mà không xung đột (tiền lệ: `LiveUsersTable` đặt 1000ms trên route
  Machines, độc lập với 30s của Overview).
- **Rollback**: fix nằm gọn 1 PR frontend; revert PR là đủ, không có migration/side-effect
  DB.

## 8. Checklist review (cho 3 lượt reviewer)

- [ ] Root cause đúng: Latency đọc `n.online` thô vs Overview đọc `/api/devices/live` hợp nhất.
- [ ] Phương án không đổi hành vi tab "Hạ tầng / Collector" (infra fallback `n.online`).
- [ ] Không gây drift mới; hợp nhất về 1 nguồn (Phương án B) hay ghi nợ rõ (Phương án A).
- [ ] nodeKey join an toàn (case-insensitive) — bám [nodeKey format asymmetry].
- [ ] **Latency gọi `useNodeLiveState({ poll: true })`** (leaf tab đứng một mình phải tự own
      polling — nếu không cột Online đóng băng = bug tái sinh).
- [ ] `useRealNodes` giữ nguyên `isFetching` (có `liveDevices`) và `isLoading` (không có).
- [ ] Test tái lập ca votam-pc trên CI; không build/test local.
- [ ] Không đụng server/DB; endpoint hợp nhất đã có + đã test.

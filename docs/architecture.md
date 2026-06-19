# 2. Kiến trúc & sơ đồ (diagrams)

Tài liệu này mô tả **mô hình kiến trúc** của ứng dụng qua các sơ đồ Mermaid:
provider tree, luồng khởi động, layout, luồng dữ liệu/error, và mô hình feature module.

## 2.1. Kiến trúc tổng thể theo tầng

```mermaid
flowchart TB
    subgraph Entry["Bootstrap — src/main.tsx"]
        QC["QueryClient<br/>(retry + error policy)"]
        RT["Router instance<br/>(createRouter)"]
    end

    subgraph ProviderTree["Provider tree (bao ngoài cùng → trong)"]
        direction TB
        P1["QueryClientProvider"]
        P2["ThemeProvider"]
        P3["FontProvider"]
        P4["DirectionProvider (RTL)"]
        P5["RouterProvider"]
        P1 --> P2 --> P3 --> P4 --> P5
    end

    subgraph RouteLayer["Route layer — TanStack Router"]
        Root["__root.tsx<br/>NavigationProgress · Outlet · Toaster · Devtools"]
        AuthGrp["(auth) group<br/>sign-in / sign-up / otp / ..."]
        ErrGrp["(errors) group<br/>401 / 403 / 404 / 500 / 503"]
        AuthLayout["_authenticated<br/>→ AuthenticatedLayout"]
        ClerkGrp["clerk/*<br/>ClerkProvider"]
        Root --> AuthGrp
        Root --> ErrGrp
        Root --> AuthLayout
        Root --> ClerkGrp
    end

    subgraph FeatureLayer["Feature layer — src/features/*"]
        Dash["dashboard"]
        Tasks["tasks"]
        Users["users"]
        Apps["apps"]
        Chats["chats"]
        Settings["settings"]
    end

    subgraph Shared["Shared — components / hooks / lib / stores / context"]
        UIComp["components/ui (shadcn)"]
        Layout["components/layout"]
        DataTable["components/data-table"]
        Stores["stores (Zustand)"]
        Lib["lib (utils, cookies, errors)"]
    end

    Entry --> ProviderTree --> RouteLayer
    AuthLayout --> FeatureLayer
    FeatureLayer --> Shared
```

## 2.2. Provider tree (thứ tự bọc trong `main.tsx`)

Thứ tự rất quan trọng: provider ngoài cùng có hiệu lực rộng nhất.

```mermaid
flowchart TD
    A["StrictMode"] --> B["QueryClientProvider<br/>(client = queryClient)"]
    B --> C["ThemeProvider<br/>(cookie: vite-ui-theme)"]
    C --> D["FontProvider"]
    D --> E["DirectionProvider<br/>(LTR / RTL)"]
    E --> F["RouterProvider<br/>(router)"]
    F --> G["… toàn bộ route & feature …"]
```

> Nguồn: [`src/main.tsx`](../src/main.tsx).

## 2.3. Layout của khu vực đã đăng nhập

`AuthenticatedLayout` ([`src/components/layout/authenticated-layout.tsx`](../src/components/layout/authenticated-layout.tsx))
bọc thêm một lớp provider cục bộ cho phần dashboard và dựng khung sidebar:

```mermaid
flowchart TD
    AL["AuthenticatedLayout"] --> SP["SearchProvider<br/>(Command Menu)"]
    SP --> LP["LayoutProvider<br/>(variant + collapsible, cookie)"]
    LP --> SBP["SidebarProvider<br/>(defaultOpen từ cookie sidebar_state)"]
    SBP --> STM["SkipToMain (a11y)"]
    SBP --> AS["AppSidebar<br/>(sidebar-data.ts)"]
    SBP --> SI["SidebarInset"]
    SI --> OUT["Outlet → trang feature"]
```

Bên trong mỗi trang feature thường có: `<Header fixed>` (Search, ThemeSwitch,
ConfigDrawer, ProfileDropdown) + `<Main>` (nội dung) + `<Dialogs>`.

## 2.4. Mô hình một feature module

Tất cả feature trong `src/features/*` theo cùng một khuôn mẫu (ví dụ `tasks`, `users`):

```mermaid
flowchart LR
    subgraph Feature["src/features/<name>/"]
        Index["index.tsx<br/>(component trang)"]
        Provider["components/<name>-provider.tsx<br/>(Context: open dialog + currentRow)"]
        Comps["components/*<br/>(table, columns, dialogs, buttons)"]
        Data["data/*<br/>(mock data + Zod schema)"]
    end

    Index --> Provider
    Index --> Comps
    Comps --> Data
    Provider -. "useXxx() hook" .-> Comps
```

**Khuôn mẫu code** (rút gọn từ `tasks/index.tsx`):

```tsx
<TasksProvider>          {/* Context giữ state dialog + dòng đang chọn */}
  <Header fixed> … </Header>
  <Main>
    <TasksPrimaryButtons />
    <TasksTable data={tasks} />
  </Main>
  <TasksDialogs />       {/* create / update / delete / import */}
</TasksProvider>
```

Provider của feature (vd `tasks-provider.tsx`) dùng `useDialogState` + `useState` để quản
lý trạng thái dialog (`'create' | 'update' | 'delete' | 'import'`) và `currentRow`, expose
qua hook `useTasks()`.

## 2.5. Luồng dữ liệu & xử lý lỗi (React Query)

`QueryClient` trong `main.tsx` cấu hình chính sách retry và **global error handling**:

```mermaid
sequenceDiagram
    participant UI as Component
    participant RQ as React Query
    participant AX as axios
    participant API as Backend API

    UI->>RQ: useQuery / useMutation
    RQ->>AX: request
    AX->>API: HTTP
    API-->>AX: response / error

    alt Thành công
        AX-->>RQ: data
        RQ-->>UI: render data (staleTime 10s)
    else Lỗi 401 (Unauthorized)
        RQ->>RQ: QueryCache.onError
        RQ-->>UI: toast "Session expired!"
        RQ->>RQ: authStore.auth.reset()
        RQ->>UI: navigate("/sign-in", {redirect})
    else Lỗi 500 (Server Error)
        RQ-->>UI: toast "Internal Server Error!"
        Note over RQ: chỉ navigate("/500") khi PROD
    else Lỗi mutation khác
        RQ->>RQ: handleServerError(error)
        RQ-->>UI: toast theo error.response.data.title
    end
```

**Chính sách retry** (rút gọn): DEV không retry (để debug nhanh); PROD retry tối đa 3 lần,
**không** retry với 401/403. `refetchOnWindowFocus` chỉ bật ở PROD. `staleTime = 10s`.

> Nguồn: [`src/main.tsx`](../src/main.tsx), [`src/lib/handle-server-error.ts`](../src/lib/handle-server-error.ts).

## 2.6. Cơ chế lưu trạng thái (persistence)

Ứng dụng không có backend nên phần lớn "sở thích người dùng" được lưu bằng **cookie**
(thông qua tiện ích `src/lib/cookies.ts`, thay cho `js-cookie`).

```mermaid
flowchart LR
    subgraph Cookies["Cookies (document.cookie)"]
        T["vite-ui-theme<br/>(1 năm)"]
        LV["layout_variant (7 ngày)"]
        LC["layout_collapsible (7 ngày)"]
        SB["sidebar_state"]
        TOK["access token<br/>(auth-store)"]
    end

    ThemeProvider --> T
    LayoutProvider --> LV
    LayoutProvider --> LC
    SidebarProvider --> SB
    AuthStore["Zustand auth-store"] --> TOK
```

## 2.7. Tích hợp Clerk (tuỳ chọn, tách rời)

Toàn bộ tích hợp Clerk nằm trong `src/routes/clerk`. `ClerkProvider` chỉ bọc nhánh
`/clerk/*`. Nếu thiếu `VITE_CLERK_PUBLISHABLE_KEY`, route sẽ hiển thị trang hướng dẫn
cấu hình thay vì crash. Có thể xoá thư mục này + gỡ `@clerk/react` mà không ảnh hưởng phần
còn lại.

```mermaid
flowchart TD
    URL["/clerk/*"] --> Check{"Có<br/>VITE_CLERK_PUBLISHABLE_KEY?"}
    Check -- "Không" --> Guide["MissingClerkPubKey<br/>(trang hướng dẫn)"]
    Check -- "Có" --> CP["ClerkProvider"]
    CP --> CAuth["(auth): sign-in / sign-up"]
    CP --> CMgmt["_authenticated: user-management"]
```

## 2.8. Di chuyển sang server mới

Về mặt **kiến trúc**, điểm cần lưu ý khi đổi server:

- **Không có tầng server** của riêng app → chỉ cần phục vụ static `dist/`. Mọi "kiến trúc
  backend" thực ra nằm ở **API bên ngoài** mà bạn cấu hình (qua `axios`), không nằm trong repo.
- **Provider/route/feature là client-side** → không phụ thuộc server cụ thể. Chỉ cần host
  phục vụ đúng file và **SPA fallback** để TanStack Router xử lý route ở client.
- **Biến môi trường `VITE_*` được nhúng lúc build** → khi sang server mới mà đổi endpoint
  API/Clerk thì **phải build lại**, không thể sửa runtime.
- **Cookie** (theme/layout/token) gắn theo domain → đổi domain sẽ mất các preference cũ
  (không ảnh hưởng chức năng).

Xem hướng dẫn thao tác chi tiết tại [server-migration.md](server-migration.md).

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Main } from '@/components/layout/main'
import { Acl } from '@/features/acl'
import { ClientConfig } from '@/features/client-config'
import { DnsSplit } from '@/features/dns-split'
import { NodeRuntimePage } from '@/features/node-runtime'
import { PacRulesPage } from '@/features/pac-rules'
import { PreAuthKeys } from '@/features/preauth-keys'
import { TailnetUsers } from '@/features/tailnet-users'

/** Gộp từ: Users, ACL Policy, Pre-auth Keys, Node Runtime, PAC Rules, Client
 *  Config, Split DNS — cùng chủ đề "ai được vào tailnet + cấu hình client
 *  agent đi kèm". Radix Tabs chỉ mount TabsContent đang active nên mỗi tab tự
 *  lazy-load dữ liệu của nó khi được mở lần đầu, không gọi API tab khác. */
export function TailnetAccess() {
  return (
    <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Tailnet Access</h2>
        <p className='text-muted-foreground'>
          Ai được vào tailnet, bằng cách nào, và cấu hình client agent đi kèm.
        </p>
      </div>

      <Tabs defaultValue='users'>
        <TabsList className='flex h-auto flex-wrap justify-start'>
          <TabsTrigger value='users'>Users</TabsTrigger>
          <TabsTrigger value='acl'>ACL Policy</TabsTrigger>
          <TabsTrigger value='keys'>Pre-auth Keys</TabsTrigger>
          <TabsTrigger value='runtime'>Node Runtime</TabsTrigger>
          <TabsTrigger value='pac'>PAC Rules</TabsTrigger>
          <TabsTrigger value='global'>Client Config</TabsTrigger>
          <TabsTrigger value='dns'>Split DNS</TabsTrigger>
        </TabsList>

        <TabsContent value='users' className='mt-4'>
          <TailnetUsers />
        </TabsContent>
        <TabsContent value='acl' className='mt-4'>
          <Acl />
        </TabsContent>
        <TabsContent value='keys' className='mt-4'>
          <PreAuthKeys />
        </TabsContent>
        <TabsContent value='runtime' className='mt-4'>
          <NodeRuntimePage />
        </TabsContent>
        <TabsContent value='pac' className='mt-4'>
          <PacRulesPage />
        </TabsContent>
        <TabsContent value='global' className='mt-4'>
          <ClientConfig />
        </TabsContent>
        <TabsContent value='dns' className='mt-4'>
          <DnsSplit />
        </TabsContent>
      </Tabs>
    </Main>
  )
}

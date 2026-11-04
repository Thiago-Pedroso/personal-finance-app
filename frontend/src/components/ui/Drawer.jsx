import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

export function Drawer({ open, onOpenChange, title, sub, children }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60
          backdrop-blur-sm animate-[overlay_.15s_ease-out]" />
        <Dialog.Content
          className="fixed right-0 top-0 z-40 flex h-dvh w-full sm:w-[min(960px,96vw)]
            flex-col sm:border-l border-border bg-bg shadow-2xl
            data-[state=open]:animate-[overlay_.18s_ease-out]
            focus:outline-none">
          <div className="flex items-start justify-between gap-4 border-b
            border-border px-4 py-3 sm:px-6 sm:py-4">
            <div>
              <Dialog.Title className="text-[16px] font-semibold">
                {title}</Dialog.Title>
              {sub && <Dialog.Description className="mt-0.5 text-[12.5px]
                text-muted">{sub}</Dialog.Description>}
            </div>
            <Dialog.Close className="-m-1 rounded-lg p-2.5 text-muted sm:m-0 sm:p-1.5
              hover:bg-surface2 hover:text-text">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-3 sm:p-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

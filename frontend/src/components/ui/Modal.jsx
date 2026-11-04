import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

export function Modal({ open, onOpenChange, title, sub, children, footer,
  width = 'max-w-lg' }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/65
          backdrop-blur-sm animate-[overlay_.15s_ease-out]" />
        <Dialog.Content
          className={`fixed inset-0 z-50 flex h-dvh w-full flex-col bg-surface
          shadow-2xl fade-in focus:outline-none sm:inset-auto sm:left-1/2 sm:top-1/2
          sm:block sm:h-auto sm:w-[94vw] ${width} max-sm:max-w-none sm:-translate-x-1/2
          sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:border-border`}>
          <div className="flex items-start justify-between gap-4 border-b
            border-border px-4 py-3 sm:px-6 sm:py-4">
            <div>
              <Dialog.Title className="text-[15px] font-semibold">
                {title}</Dialog.Title>
              {sub && <Dialog.Description className="mt-1 text-[12.5px]
                text-muted">{sub}</Dialog.Description>}
            </div>
            <Dialog.Close className="-m-1.5 rounded-lg p-2.5 text-muted sm:m-0 sm:p-1.5
              hover:bg-surface2 hover:text-text">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:max-h-[68vh]
            sm:px-6 sm:py-5">{children}</div>
          {footer && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-border
              px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

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
          className={`fixed left-1/2 top-1/2 z-50 w-[94vw] ${width}
          -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border
          bg-surface shadow-2xl fade-in focus:outline-none`}>
          <div className="flex items-start justify-between gap-4 border-b
            border-border px-6 py-4">
            <div>
              <Dialog.Title className="text-[15px] font-semibold">
                {title}</Dialog.Title>
              {sub && <Dialog.Description className="mt-1 text-[12.5px]
                text-muted">{sub}</Dialog.Description>}
            </div>
            <Dialog.Close className="rounded-lg p-1.5 text-muted
              hover:bg-surface2 hover:text-text">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="max-h-[68vh] overflow-y-auto px-6 py-5">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-border
              px-6 py-4">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

import { toast } from 'sonner'

/** Copy a read-only device report and point the user at GitHub to paste it. Nothing is sent anywhere by Hubless. */
export function copyDeviceReport(id: string) {
  window.hubless.copyDeviceReport(id).then(
    () =>
      toast.success('Device report copied', {
        description: 'Paste it into a new issue on GitHub. It contains no serial numbers or personal data.',
        action: { label: 'Open GitHub', onClick: () => window.open('https://github.com/Ynnad242/hubless/issues/new', '_blank') }
      }),
    (e) => toast.error(e.message)
  )
}

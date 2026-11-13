import { IconError, IconInfo, IconSpinner, IconSuccess, IconWarning } from "@/components/icons";
import { useTheme } from "@/lib/theme"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolved: theme } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <IconSuccess className="size-4" />,
        info: <IconInfo className="size-4" />,
        warning: <IconWarning className="size-4" />,
        error: <IconError className="size-4" />,
        loading: <IconSpinner className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
